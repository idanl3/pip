-- Phase 2: families, children, and who is allowed to see them.
--
-- Shape of the thing: one parent account owns one family, which has children.
-- A family starts as 'pending' and cannot run sessions until the owner of the
-- service approves it. Any edit by a parent sends it back for review.
--
-- Two rules run through all of this:
--
--   1. Nothing is granted to the `anon` role. An unauthenticated visitor can
--      read nothing at all, not even which tables exist.
--   2. A parent may edit their family's content but may not grade it. Status,
--      review notes and minute limits belong to the admin, and that is
--      enforced in the database by trigger, not in the browser.
--
-- The publishable key is baked into a public website, so the database has to
-- assume every request is hostile and hold on its own.


-- ===========================================================================
-- Admins
-- ===========================================================================

-- Membership of this table is what makes someone an admin.
--
-- It is deliberately unreachable through the Data API: no grants are issued,
-- row-level security is on, and no policy is ever created. The effect is that
-- no API caller can read it, write it, or confirm it exists. Only the
-- security-definer function below can see inside, which is why that function
-- is the single way anything checks for admin rights.
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

comment on table public.admins is
  'Admin roster. No grants and no policies on purpose: unreachable from the '
  'Data API, readable only through public.is_admin().';


create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True when the caller is an admin. Security definer so that policies can '
  'test admin rights without the admins table being readable by anyone.';


-- ===========================================================================
-- Families
-- ===========================================================================

create table public.families (
  id       uuid primary key default gen_random_uuid(),

  -- One account owns one family. Two parents sharing one family, each with
  -- their own login, is a later phase; the pilot does not need it.
  owner_id uuid not null unique references auth.users (id) on delete cascade,

  -- What the children actually call their parents, in their words: "Mom",
  -- "Dad". Pip addresses the parent with these, so they are not formal names.
  parent_names text[] not null default '{}',

  language text not null default 'en',

  -- pending       - waiting for the owner of the service to review
  -- approved      - may run sessions
  -- needs_changes - sent back, with review_note explaining what to fix
  -- suspended     - stopped by the owner; the family cannot even edit
  status      text not null default 'pending',
  review_note text,

  monthly_minute_limit integer not null default 120,

  -- The free-text parts of the family profile. These reach Pip's prompt as
  -- variables, which is why they are length-capped: a prompt is not a place
  -- for unbounded input.
  recurring_conflicts text,
  house_rules         text,
  extra_care          text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint families_language_valid
    check (language in ('en', 'he')),

  constraint families_status_valid
    check (status in ('pending', 'approved', 'needs_changes', 'suspended')),

  constraint families_minute_limit_sane
    check (monthly_minute_limit between 0 and 10000),

  -- Subqueries are not allowed in a check constraint, so the per-element
  -- length is approximated by capping the joined string.
  constraint families_parent_names_sane
    check (
      coalesce(array_length(parent_names, 1), 0) <= 4
      and length(coalesce(array_to_string(parent_names, ','), '')) <= 160
    ),

  constraint families_text_lengths
    check (
      length(coalesce(recurring_conflicts, '')) <= 1000
      and length(coalesce(house_rules, '')) <= 1000
      and length(coalesce(extra_care, '')) <= 1000
      and length(coalesce(review_note, '')) <= 1000
    )
);

create index families_status_idx on public.families (status);

comment on table public.families is
  'One row per family, owned by one parent account.';
comment on column public.families.parent_names is
  'What the children call their parents, in the childrens words.';
comment on column public.families.language is
  'Kept from the start even though only English is built, so adding Hebrew '
  'later does not need a migration.';


-- ===========================================================================
-- Children
-- ===========================================================================

create table public.children (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  -- First names only. No surnames, no school, no address, no photograph, no
  -- date of birth. Age is enough for Pip to adapt how it speaks, and a date
  -- of birth would be a real identifier where a number is not.
  first_name text     not null,
  age        smallint not null,

  -- Hebrew inflects verbs and adjectives by gender, so Pip cannot form a
  -- correct sentence to a child without knowing it. That is the only reason
  -- this column exists, and it is the only thing it is used for.
  gender text,

  -- What this child is like, and what they tend to do when a fight starts.
  -- Pip uses these to notice the right things rather than to label the child.
  personality       text,
  conflict_tendency text,

  -- Display order in the parent's interface. Not meaningful to Pip.
  sort_order smallint not null default 0,

  created_at timestamptz not null default now(),

  constraint children_first_name_sane
    check (length(first_name) between 1 and 40),

  constraint children_age_sane
    check (age between 1 and 18),

  constraint children_gender_valid
    check (gender is null or gender in ('girl', 'boy', 'other')),

  constraint children_text_lengths
    check (
      length(coalesce(personality, '')) <= 500
      and length(coalesce(conflict_tendency, '')) <= 500
    )
);

create index children_family_id_idx on public.children (family_id);

comment on table public.children is
  'First name, age and temperament only. The most sensitive table here; keep '
  'it that way and do not add identifying columns.';
comment on column public.children.gender is
  'For Hebrew grammatical agreement only. Nothing else reads it.';


-- ===========================================================================
-- Helpers used by the policies
-- ===========================================================================

-- Security definer so that a policy on `children` can ask about a family
-- without triggering row-level security on `families` inside the policy,
-- which is both slower and harder to reason about.
--
-- A suspended family is treated as owning nothing, so suspension stops reads
-- and writes without a separate policy for every table.
create function public.owns_active_family(fam uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.families
     where id = fam
       and owner_id = auth.uid()
       and status <> 'suspended'
  );
$$;

comment on function public.owns_active_family(uuid) is
  'True when the caller owns this family and it is not suspended.';


-- ===========================================================================
-- Keeping parents out of the admin's columns
-- ===========================================================================

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- A parent may describe their family. They may not approve it, raise their own
-- minute limit, rewrite the reviewer's note, or hand the family to somebody
-- else. Rather than trusting the browser to leave those fields alone, the
-- database puts them back.
--
-- Column-level grants would be the tidier tool, but admins authenticate as the
-- same `authenticated` role as everyone else, so a grant cannot tell them
-- apart. A trigger can.
create function public.guard_family_changes()
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

comment on function public.guard_family_changes() is
  'Restores the columns that belong to the admin, and sends any parent edit '
  'back to pending review.';


-- Editing a child is editing the profile, so it must also send the family back
-- for review. Otherwise a parent could change a child's age after approval and
-- never be looked at again.
create function public.children_send_family_for_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fam uuid := coalesce(new.family_id, old.family_id);
begin
  if not public.is_admin() then
    update public.families
       set status = 'pending'
     where id = fam
       and status in ('approved', 'needs_changes');
  end if;

  return coalesce(new, old);
end;
$$;


create trigger families_touch_updated_at
  before update on public.families
  for each row execute function public.touch_updated_at();

create trigger families_guard_changes
  before insert or update on public.families
  for each row execute function public.guard_family_changes();

create trigger children_send_family_for_review
  after insert or update or delete on public.children
  for each row execute function public.children_send_family_for_review();


-- ===========================================================================
-- Row-level security
-- ===========================================================================
-- The project has an event trigger that enables row-level security on new
-- tables automatically. It is still written out here, so that the schema says
-- what it means on its own and does not depend on a project setting staying
-- switched on.

alter table public.families enable row level security;
alter table public.children enable row level security;

-- Families -------------------------------------------------------------------

create policy families_select on public.families
  for select to authenticated
  using (owner_id = auth.uid() or public.is_admin());

create policy families_insert on public.families
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy families_update_own on public.families
  for update to authenticated
  using (owner_id = auth.uid() and status <> 'suspended')
  with check (owner_id = auth.uid());

create policy families_update_admin on public.families
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A family can delete itself. This project collects as little as possible and
-- should make leaving easy; the cascade takes the children with it.
create policy families_delete on public.families
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- Children -------------------------------------------------------------------

create policy children_select on public.children
  for select to authenticated
  using (public.owns_active_family(family_id) or public.is_admin());

create policy children_insert on public.children
  for insert to authenticated
  with check (public.owns_active_family(family_id) or public.is_admin());

create policy children_update on public.children
  for update to authenticated
  using (public.owns_active_family(family_id) or public.is_admin())
  with check (public.owns_active_family(family_id) or public.is_admin());

create policy children_delete on public.children
  for delete to authenticated
  using (public.owns_active_family(family_id) or public.is_admin());


-- ===========================================================================
-- Grants
-- ===========================================================================
-- The project is set not to expose new tables automatically, so access has to
-- be granted by hand. That is the point: a table nobody thought about is
-- unreachable rather than open.
--
-- `anon` is granted nothing beyond entering the schema. Everything here is
-- behind a login.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.families to authenticated;
grant select, insert, update, delete on public.children to authenticated;

grant execute on function public.is_admin()                  to authenticated;
grant execute on function public.owns_active_family(uuid)     to authenticated;

-- Nothing is granted on public.admins, to anyone, ever.
