-- Make the invitation the real gate, in the database.
--
-- Whether strangers can create an account is a project setting, and a project
-- setting is not a security boundary: it can be flipped in a dashboard by
-- accident and nothing in this repository would notice. So the rule that
-- actually matters is enforced here instead — an account with no redeemed
-- invitation cannot create a family profile, and without a family profile an
-- account can do nothing at all. It holds no matter how signup is configured.


-- Redeems a code for the signed-in caller.
--
-- Security definer because public.invites is admin-only and must stay that
-- way: a parent cannot read the table, so they cannot list codes or probe for
-- them. This is the one narrow door, and it only ever writes the caller's own
-- id.
--
-- It returns a plain true or false and never says *why* a code failed. That
-- is deliberate: distinguishing "no such code" from "already used" from
-- "expired" would turn this into an oracle for guessing codes. Codes carry
-- about 59 bits of randomness, so guessing is hopeless, and there is no
-- reason to help.
create function public.redeem_invite(invite_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rows_changed integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  -- Already holding a redeemed invitation: report success rather than
  -- failure, so reloading the page or tapping twice is harmless.
  if exists (select 1 from public.invites where used_by = auth.uid()) then
    return true;
  end if;

  update public.invites
     set used_at = now(),
         used_by = auth.uid()
   where code = upper(btrim(invite_code))
     and used_at is null
     and expires_at > now();

  get diagnostics rows_changed = row_count;
  return rows_changed = 1;
end;
$$;

comment on function public.redeem_invite(text) is
  'Claims an invite code for the signed-in caller. Returns true or false and '
  'deliberately never explains a failure.';

revoke all on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;


-- Same guard as before, with one addition: creating a family now requires a
-- redeemed invitation. Replaced whole rather than patched so that the rules
-- governing a parent write can be read in one place.
create or replace function public.guard_family_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_admin() then
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
