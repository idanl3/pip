-- Let the edge functions read and write what they need.
--
-- The trap, written down because it cost an hour and will cost it again:
--
--   service_role bypasses row-level security. It does NOT bypass grants.
--
-- Those are two separate mechanisms and only the first is famous. A Supabase
-- project normally hides this, because by default it grants everything in
-- `public` to service_role. Turning off "automatically expose new tables" — a
-- deliberate choice here, so a table nobody thought about is unreachable
-- rather than open — switches that off as well, for service_role along with
-- everyone else.
--
-- The result was that every edge function failed with:
--
--   42501 permission denied for table families
--
-- which surfaced to a parent as "Something went wrong. Please try again." and
-- looked for all the world like broken business logic. It was found only after
-- adding a debug channel to pass the underlying error back.
--
-- Granted per table rather than wholesale. A new function touching a new table
-- will need a line here, and will fail loudly rather than quietly until it
-- gets one. That is the intended trade: this project would rather be
-- interrupted than permissive.

-- start-session and end-session read the family to check approval, status and
-- limits. They never write to it: a family's status belongs to the admin.
grant select on public.families to service_role;

-- start-session reads the children to build the agent's variables.
grant select on public.children to service_role;

-- Sessions are written only here. The browser has select and nothing else, so
-- a parent cannot invent a session or shorten one to save minutes.
grant select, insert, update on public.sessions to service_role;

-- Derived usage, for the monthly limit check.
grant select on public.family_usage to service_role;

-- Deliberately not granted: public.admins and public.invites. No function has
-- any business reading the admin roster, and invitations are redeemed through
-- a security-definer function called by the parent, not by a service.
