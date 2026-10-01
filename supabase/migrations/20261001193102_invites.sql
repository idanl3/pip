-- Invite codes, so a family can join from a link instead of waiting for an
-- email.
--
-- Why not magic links: Supabase's built-in mailer allows only a handful of
-- messages an hour and is not meant for production, so a family's login would
-- depend on an email that might never arrive. The owner would rather hand
-- someone a link directly. An invite code does that, and it needs no mail
-- server at all.
--
-- An invite code is a credential. It is generated from cryptographically
-- random bytes, never from random(), and this table is readable only by
-- admins: a parent cannot list codes, test codes, or discover that any exist.
-- The function that redeems one runs server-side with the secret key, which
-- bypasses row-level security, so redemption never needs the browser to be
-- trusted.

create table public.invites (
  code text primary key,

  -- The owner's own note about who this was meant for. Not shown to the
  -- family. Avoid putting a child's name in it; an adult's first name or
  -- "the Cohens next door" is the intent.
  label text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',

  -- Set when redeemed. A code works exactly once.
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,

  constraint invites_code_shape    check (code ~ '^[A-Z2-9]{12}$'),
  constraint invites_label_length  check (length(coalesce(label, '')) <= 120),
  constraint invites_used_together check ((used_at is null) = (used_by is null))
);

create index invites_unused_idx on public.invites (expires_at)
  where used_at is null;

comment on table public.invites is
  'One-shot codes that let a family create an account. Admin-only: a parent '
  'can neither read this table nor probe it.';


-- Generates a code that can be read aloud, typed from a message, or pasted
-- from a link without ambiguity: no O/0, no I/1/l.
--
-- Twelve characters from a 31-character alphabet is about 59 bits, which is
-- far beyond guessing. The bytes come from pgcrypto rather than random(),
-- because random() is predictable and this value is a credential. Reducing a
-- 0-255 byte modulo 31 is very slightly biased; at this length that changes
-- nothing that matters.
create function public.generate_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                  1 + (get_byte(bytes, i) % 31),
                  1),
           '' order by i)
    from (select extensions.gen_random_bytes(12) as bytes) r,
         generate_series(0, 11) as i;
$$;

comment on function public.generate_invite_code() is
  'A 12-character invite code from cryptographically random bytes, in an '
  'alphabet with no ambiguous letters.';


alter table public.invites enable row level security;

-- Admins only, for every operation. There is deliberately no policy that any
-- ordinary parent can satisfy, so the table is invisible to them: a code
-- cannot be listed, guessed at by probing, or confirmed to exist.
create policy invites_admin_select on public.invites
  for select to authenticated using (public.is_admin());

create policy invites_admin_insert on public.invites
  for insert to authenticated with check (public.is_admin());

create policy invites_admin_update on public.invites
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy invites_admin_delete on public.invites
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.invites to authenticated;
grant execute on function public.generate_invite_code() to authenticated;
