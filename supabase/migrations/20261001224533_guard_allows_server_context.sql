-- Let a trusted server context change a family, instead of treating it as a
-- parent trying to grade their own profile.
--
-- The guard asks "is the caller an admin?" and, if not, puts status, limits and
-- the reviewer's note back. That is right for a parent. It was also being
-- applied to migrations, maintenance scripts and anything else running without
-- a signed-in user, because `is_admin()` reads `auth.uid()` and a server
-- context has none. The effect was that
--
--   update public.families set status = 'approved' where ...
--
-- run from a script appeared to work and silently left the row as 'pending'.
-- A guard that silently undoes a deliberate change is worse than one that
-- refuses it.
--
-- So: no signed-in user means no parent is making this change, and the
-- restrictions do not apply.
--
-- Why that is safe, by elimination of everyone who can reach these triggers:
--
--   authenticated  always has auth.uid(), so a parent is still fully bound.
--   anon           has no grant on families at all and cannot reach it.
--   service_role   has only SELECT on families and cannot write to it.
--   postgres       is migrations and the owner's own scripts, already trusted.
--
-- The invitation requirement moves with it, for the same reason: the gate
-- exists to stop an uninvited *parent* creating a profile, and a parent always
-- has a uid.

create or replace function public.guard_family_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An admin, or nobody signed in at all. Either way, not a parent grading
  -- their own homework.
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.invites where used_by = auth.uid()) then
      raise exception 'An invitation is needed before a family profile can be created.'
        using errcode = '42501';
    end if;

    new.owner_id             := auth.uid();
    new.status               := 'pending';
    new.review_note          := null;
    new.monthly_minute_limit := 120;  -- matches the column default
    return new;
  end if;

  -- Any edit by a parent sends the profile back for review. A suspended
  -- family stays suspended: editing is not a way out of it.
  new.owner_id             := old.owner_id;
  new.monthly_minute_limit := old.monthly_minute_limit;
  new.review_note          := old.review_note;
  new.status := case
    when old.status = 'suspended' then 'suspended'
    else 'pending'
  end;

  return new;
end;
$$;


-- Same reasoning for the children trigger. A script seeding test children
-- should not knock a family back to pending as a side effect.
create or replace function public.children_send_family_for_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fam uuid := coalesce(new.family_id, old.family_id);
begin
  if not public.is_admin() and auth.uid() is not null then
    update public.families
       set status = 'pending'
     where id = fam
       and status in ('approved', 'needs_changes');
  end if;

  return coalesce(new, old);
end;
$$;
