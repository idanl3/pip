-- What a family's profile means in practice.
--
-- The prompt has a section called "What this profile means in practice", and
-- it is the reason Pip adapted properly to a five-year-old. It turned facts
-- into instructions:
--
--   fact      Mai, age 5. Shy. Gets very upset when overwhelmed.
--   practice  "Mai is young and shy. Speak to her in very short, simple
--              sentences, offer choices instead of open questions, and never
--              let the older two speak over her."
--
-- That translation is a professional judgement - a parent coach reading a
-- profile and saying what it means for a mediator. It is not something the
-- parent should be asked for, and it is not something a lookup table can do:
-- "never let the older two speak over her" came from combining her age with
-- her siblings' ages with the fact that one of them talks over people.
--
-- So it is written per family, by an AI given the whole method and the whole
-- profile, and reviewed by the owner before the family is approved. This table
-- holds the result.
--
-- A separate table rather than a column on families, for one reason: the
-- parent can read their own family row, and this is not for them. It is a
-- professional's read on their child and sits alongside the rest of the prompt
-- they never see. Row-level security is per row, not per column, so a column
-- here would be a column the parent could read.

create table public.practice_notes (
  family_id uuid primary key references public.families (id) on delete cascade,

  notes text not null,

  -- Who or what produced it, so a later session can tell a hand-written note
  -- from a generated one without guessing.
  source text not null default 'manual',

  updated_at timestamptz not null default now(),

  constraint practice_notes_length check (length(notes) between 1 and 4000),
  constraint practice_notes_source_valid check (source in ('manual', 'generated'))
);

comment on table public.practice_notes is
  'Per-family practical guidance for the agent. Admin-only: this is a '
  'professional read on somebody child and is not shown to the parent.';


alter table public.practice_notes enable row level security;

-- Admins only. There is deliberately no policy a parent can satisfy, so the
-- table is invisible to them rather than merely read-only.
create policy practice_notes_admin_select on public.practice_notes
  for select to authenticated using (public.is_admin());

create policy practice_notes_admin_insert on public.practice_notes
  for insert to authenticated with check (public.is_admin());

create policy practice_notes_admin_update on public.practice_notes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy practice_notes_admin_delete on public.practice_notes
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.practice_notes to authenticated;

-- start-session reads it to fill the prompt variable.
grant select on public.practice_notes to service_role;


create function public.touch_practice_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger practice_notes_touch
  before update on public.practice_notes
  for each row execute function public.touch_practice_notes();
