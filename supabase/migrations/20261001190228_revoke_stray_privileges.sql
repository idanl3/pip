-- Take away privileges the API roles were given by default and should never
-- have had.
--
-- A new project hands `anon` and `authenticated` TRUNCATE, TRIGGER and
-- REFERENCES on every table in `public`, through the schema's default
-- privileges. Turning off "automatically expose new tables" removes the data
-- privileges but leaves these three behind, so they were sitting on `admins`
-- as well as on the family tables.
--
-- None of it is reachable through the Data API as things stand: PostgREST has
-- no verb that maps to TRUNCATE, and neither CREATE TRIGGER nor a foreign key
-- can be issued over REST. So this is not a hole today. It is removed because
-- of what the privileges would mean if one ever opened:
--
--   TRUNCATE   ignores row-level security completely. Not "policies deny it" —
--              policies are never consulted. Any route that reached it would
--              empty the admin roster or every family in one statement.
--   TRIGGER    allows attaching a function to a table, which is arbitrary code
--              running on somebody else's writes.
--   REFERENCES allows pointing a foreign key at the table, which can block
--              deletions elsewhere.
--
-- The surrounding design assumes the database defends itself, because the
-- publishable key is baked into a public website. Leaving privileges lying
-- around on the strength of "the current API cannot use them" is the opposite
-- of that.

revoke truncate, trigger, references on public.admins   from anon, authenticated;
revoke truncate, trigger, references on public.families from anon, authenticated;
revoke truncate, trigger, references on public.children from anon, authenticated;

-- Stop the same three coming back on every table added from now on. Scoped to
-- the role that owns migrations, and only to these privileges for these two
-- roles, so nothing Supabase relies on is disturbed.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
