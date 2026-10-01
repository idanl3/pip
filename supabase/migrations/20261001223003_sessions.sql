-- Sessions: when Pip was used, for how long, and by which agent.
--
-- What this table deliberately does not hold:
--
--   Which children took part. The brief lists a session log as "start time,
--   duration, which agent" and nothing more, and the owner can read these
--   rows. Recording that Negev and Nina argued on Tuesday evening would be a
--   log of a family's arguments, which is not ours to keep.
--
--   Anything either child said. Not a word, not a summary. Transcripts never
--   reach this database; the browser builds the recap and encrypts it before
--   it is uploaded, and even that is unreadable to the owner.
--
-- What it does hold is enough to enforce a monthly limit and to notice that
-- something went wrong.

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  -- ElevenLabs hands back a conversation id when the token is issued, before
  -- a word is spoken. Storing it is what lets the billing webhook find the
  -- right row later.
  conversation_id text,
  agent_id        text not null,

  started_at timestamptz not null default now(),
  ended_at   timestamptz,

  duration_seconds integer,

  -- Where the duration came from, because the three sources are not equally
  -- trustworthy and a bill should say which it believed:
  --   webhook  - ElevenLabs told us. Authoritative.
  --   client   - the browser reported the end. Good enough.
  --   assumed  - nobody reported anything and the row was swept up as stale,
  --              so the full session length was charged.
  duration_source text,

  -- Phase 7's safety alert sets this. A single boolean and nothing else: that
  -- a child said something needing a parent is the parent's business, and the
  -- substance of it is nobody else's.
  safety_alert boolean not null default false,

  created_at timestamptz not null default now(),

  constraint sessions_duration_sane
    check (duration_seconds is null or duration_seconds between 0 and 7200),

  constraint sessions_duration_source_valid
    check (duration_source is null or duration_source in ('webhook', 'client', 'assumed')),

  -- A finished session has both, or neither.
  constraint sessions_ended_together
    check ((ended_at is null) = (duration_seconds is null))
);

create index sessions_family_started_idx on public.sessions (family_id, started_at desc);
create index sessions_conversation_idx on public.sessions (conversation_id)
  where conversation_id is not null;

-- One live session per family, enforced by the database rather than by a check
-- in a function that could be raced. Two tabs, or two parents on two phones,
-- cannot start Pip twice and pay twice.
--
-- A session abandoned without anyone reporting the end would block the family
-- forever, so start-session sweeps up anything older than the maximum
-- duration before it tries to insert.
create unique index sessions_one_live_per_family on public.sessions (family_id)
  where ended_at is null;

comment on table public.sessions is
  'When Pip ran and for how long. Never who said what, and never which '
  'children took part.';


-- Minutes used this calendar month, against the family's limit.
--
-- Derived rather than counted. A running total in a column would need keeping
-- in step with every webhook, retry and sweep, and a usage counter that has
-- drifted is worse than no counter: it either blocks a family who has minutes
-- left or bills one who does not.
--
-- security_invoker means the view obeys the caller's row-level security, so a
-- parent sees their own row and nobody else's.
create view public.family_usage with (security_invoker = true) as
select
  f.id as family_id,
  f.monthly_minute_limit,
  coalesce(
    ceil(
      sum(s.duration_seconds) filter (
        where s.started_at >= date_trunc('month', now())
      )::numeric / 60.0
    ),
    0
  )::integer as minutes_used
from public.families f
left join public.sessions s on s.family_id = f.id
group by f.id, f.monthly_minute_limit;

comment on view public.family_usage is
  'Minutes used this calendar month, derived from sessions so it cannot drift.';


alter table public.sessions enable row level security;

-- Reading only. Every write happens in an edge function with the service
-- role, which bypasses this.
--
-- That is not bureaucracy. If a parent could update their own session rows
-- they could set duration_seconds to zero and never use a minute, and the
-- monthly limit would be decorative. Durations are therefore computed
-- server-side from started_at, where the browser cannot reach them.
create policy sessions_select on public.sessions
  for select to authenticated
  using (public.owns_active_family(family_id) or public.is_admin());

grant select on public.sessions to authenticated;
grant select on public.family_usage to authenticated;

-- Deliberately no insert, update or delete for anyone. Not an omission.
