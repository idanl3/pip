-- Let a family delete their account.
--
-- invites.used_by points at auth.users with `on delete set null`, so deleting
-- an account nulls that column while used_at stays set. The original
-- constraint insisted the two were always null together, so the foreign key's
-- own cleanup violated it and the delete was refused outright:
--
--   new row for relation "invites" violates check constraint
--   "invites_used_together"
--
-- The effect was that any parent who had redeemed an invitation — which is all
-- of them — could never delete their account. This project deliberately makes
-- leaving easy, and collects as little as possible, so that is a real fault
-- rather than a cosmetic one. It was found by scripts/test-rls.ps1 rather than
-- by a family discovering it.
--
-- The replacement keeps the half of the invariant that is worth having, and
-- drops the half that was wrong. A redeemer with no timestamp would be
-- nonsense, so that stays forbidden. A timestamp with no redeemer is simply
-- "this code was spent, by an account that no longer exists", which is both
-- true and worth keeping: the code is still spent and must not be reusable.

alter table public.invites
  drop constraint invites_used_together;

alter table public.invites
  add constraint invites_used_by_needs_timestamp
  check (used_by is null or used_at is not null);
