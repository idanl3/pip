# Where the project stands

**Last updated:** 2026-10-01

Three files carry the whole handover. Read all of them before doing anything:

| File | What it holds |
| --- | --- |
| `CLAUDE.md` | The brief, and section 12's amendments which **override** it |
| `PROGRESS.md` | This file. What is built, what is next, what is blocked |
| `DECISIONS.md` | Why things are the way they are. Read before changing an approach |

---

## Right now

**Phase 1 is complete.** The site is live on HTTPS at
https://pip.linnewiel.com with HTTP redirecting to it.

**Phase 2 is part-built.** The schema, the row-level security policies and the
guard triggers are applied and verified — `scripts/test-rls.ps1` runs 20 checks
against the live database and all pass. Still to build: login, the onboarding
form, and the admin approval screen.

**Not blocked**, but magic-link login will need custom SMTP before real
families can use it. See "Owed by the owner".

---

## What is live

| Thing | Where | State |
| --- | --- | --- |
| Site | https://pip.linnewiel.com | Serving over HTTPS, HTTP redirects. Let's Encrypt certificate renews itself; expires 2026-12-30 |
| Repository | https://github.com/idanl3/pip | Public, as the free Pages plan requires |
| Deploy | GitHub Actions, on push to `main` | Working, roughly 20 seconds end to end |
| Supabase | `crlobhzwmqvyqvstvmho`, eu-central-1, Postgres 17.11, free plan | `ACTIVE_HEALTHY`. Auth, Data API and migrations all confirmed working |
| ElevenLabs | English and Hebrew agents | Configured by hand in the dashboard. **This project has not touched them yet** |

---

## Phases

| # | Phase | State |
| --- | --- | --- |
| 1 | Project setup, Pages, domain | **Done** |
| 2 | Accounts and onboarding | **In progress.** Schema, policies and triggers done and tested. Login, onboarding form and admin screen still to build |
| 3 | Agent templating | Not started. Narrower than the brief says — see `CLAUDE.md` §12 |
| 4 | Sessions, PIN, kids' blob screen | Not started. HTTPS is in place, so microphone access will work |
| 5 | Minute tracking and limits | Not started |
| 6 | Encryption and recaps | Not started |
| 7 | Safety alert and polish | Not started. Hebrew review is out of scope for now |

---

## Environment

`.env` is gitignored and must never be committed; the repository is public.
Names only below, never values.

| Variable | State | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | set | Public. Bundled into the site |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | set | Public by design. Replaces the old anon key |
| `SUPABASE_DB_PASSWORD` | set | Used to build the connection string |
| `SUPABASE_DB_HOST` | set | The pooler, not the direct host. See the gotchas |
| `SUPABASE_DB_USER` | set | `postgres.<project-ref>`, the pooler username form |
| `SUPABASE_ACCESS_TOKEN` | set | Scoped token, **expires around 2026-12-30** |
| `ELEVENLABS_API_KEY` | empty | Phase 3 |
| `ELEVENLABS_AGENT_ID_EN` | empty | Phase 3 |
| `SUPABASE_SECRET_KEY` | empty | Only if a function must bypass row-level security |

Load it all with `. .\scripts\load-env.ps1`, which also refreshes PATH and
assembles `PIP_DB_URL`. Dot-source it; running it does nothing useful.

Tooling: Node 24.19.0, npm 11.17, gh 2.102, Vite 8.3.2, Supabase CLI 2.119.0.
Vite and the Supabase CLI are dev dependencies, not global installs.

### Running migrations

```powershell
. .\scripts\load-env.ps1
npx supabase db push --db-url $env:PIP_DB_URL
npx supabase migration list --db-url $env:PIP_DB_URL
```

The CLI is deliberately **not linked** to the project. See decision 12.

### Scripts

| Script | What it does |
| --- | --- |
| `load-env.ps1` | Dot-source first. Refreshes PATH, loads `.env`, builds `PIP_DB_URL` |
| `test-rls.ps1` | Attacks the schema with two real accounts. Run after any policy change |
| `npm test` | Playwright, in a real browser. Walks the whole join-and-onboard journey |
| `verify-deploy.ps1` | Checks the **live** site really works. Run before asking anyone to test |
| `new-invite.ps1` | Creates an invitation and prints the link. For the bootstrap case |
| `make-admin.ps1` | Puts an account on the admin roster. Only route in — that table is API-unreachable |

### Checking the security still holds

```powershell
.\scripts\test-rls.ps1
```

Creates two real accounts, attacks the schema with them, deletes them again.
Run it after touching any policy, trigger or grant. 20 checks; anything other
than "20 passed, 0 failed" means a rule stopped holding.

### The database schema

Three tables. `admins` is the roster of people who may approve families, and
has **no grants and no policies at all**, so it is unreachable through the API
— only the security-definer function `is_admin()` can see inside it.
`families` is one row per parent account. `children` holds first name, age,
gender and two short free-text notes, and nothing else; it is the most
sensitive table in the project and should stay that small.

Status, reviewer notes and minute limits belong to the admin. Parents cannot
write them even by sending the fields directly — a trigger puts them back —
and any parent edit sends the family back to `pending`.

---

## Gotchas found the hard way

Each of these cost time. Don't rediscover them.

- **`GET /rest/v1/` returns an empty 401 even when everything is fine.** That
  path serves the OpenAPI spec and is closed by default. It is *not* a sign the
  Data API is off. To test the Data API, request a table that does not exist
  and look for a `PGRST205` error — that proves PostgREST is alive and the key
  was accepted.
- **`db.<ref>.supabase.co` is IPv6-only** and this machine is IPv4-only, so the
  direct database host is simply unreachable. Everything goes through the
  pooler. This is not a Supabase outage and not a firewall problem.
- **The pooler hostname is not discoverable** with a project-scoped token: the
  endpoint that would report it needs a `Connection Pooling` permission. It was
  found by trying the regional candidates. `aws-1-eu-central-1` is ours;
  `aws-0-eu-central-1` accepts TCP but rejects the tenant, which looks like a
  credentials problem and is not.
- **When the Supabase CLI fails on permissions, probe the Management API
  directly** rather than guessing which scope to add. Call the endpoints with
  `Authorization: Bearer $env:SUPABASE_ACCESS_TOKEN` and see which ones 403.
  That turned a guessing game into a two-minute answer.
- **An interactive element can render perfectly and do nothing at all.** The
  "Add another child" button was written with no click handler; the only code
  touching it adjusted its visibility. It looked enabled and was inert. To find
  this class of bug, list every id in the markup and check each one is actually
  referenced by a handler — or just run `npm test`, which now asserts it.
- **Playwright's own browser will not download here**, so the tests drive the
  Chrome already installed on the machine via `channel: 'chrome'`. Don't
  "fix" this by reinstating the download.
- **A green deploy proves nothing. HTTP 200 proves nothing.** GitHub Actions
  has no `.env`, so the first deploy of the real pages built without
  `VITE_SUPABASE_URL`. Nothing failed. Every page returned 200, looked
  completely normal, and could not reach the database: the policy shipped as
  `connect-src 'self'` with no Supabase origin, and `import.meta.env` arrived
  undefined, so each page threw before rendering. It was found by fetching the
  live bundle and grepping it for the project ref. Two guards now exist —
  `vite.config.js` refuses to build without the variables, and
  `scripts/verify-deploy.ps1` checks the live site. **Run it before asking
  anyone to test.**
- **`@($null).Count` is 1 in PowerShell, not 0.** PostgREST returns `[]` for no
  rows, `ConvertFrom-Json` turns `[]` into `$null`, and wrapping that in `@()`
  produces a one-element array. This made the security test report four
  cross-family data leaks that did not exist. Count rows with the `RowCount`
  helper in `scripts/test-rls.ps1`, never inline.
- **Supabase's built-in email is rate-limited to a handful per hour.** It is
  not a production mailer. This bit as a mysterious `invalid_credentials` on a
  test's second run, because the signup underneath had silently failed. It
  matters far beyond tests: magic-link login *is* the authentication, so the
  pilot needs custom SMTP.
- **Seeding `auth.users` by hand: four columns have no default** —
  `confirmation_token`, `recovery_token`, `email_change_token_new` and
  `email_change`. Their siblings default to `''`. GoTrue reads them into plain
  Go strings, so leaving them NULL makes sign-in fail with an opaque **500**.
  Set them to `''`. An `auth.identities` row is required too.
- **Free Supabase projects pause after one week of inactivity.** A quiet week
  in a pilot about sibling fights is entirely plausible, and a paused project
  means logins fail. Needs a scheduled ping; pair it with the recap cleanup job
  in phase 5.
- **Free Supabase has no automatic backups.** 500 MB database, 2 project limit.
- **PowerShell blocks `npx.ps1`** with "running scripts is disabled on this
  system". Use `npx.cmd`, or run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **Don't pipe a native command through `2>&1` in PowerShell 5.1.** It wraps
  every stderr line in a NativeCommandError and makes successful commands look
  like they failed. stderr is captured anyway.
- **New shells in a session don't see freshly installed tools.** The agent's
  shell captured `PATH` at startup. `scripts/load-env.ps1` fixes it.
- **`https://idanl3.github.io/pip/` looks broken** — page loads, stylesheet
  404s. Correct and expected: assets are addressed from the domain root, which
  is right for `pip.linnewiel.com` and wrong for a `/pip/` subpath. Judge the
  site only on the custom domain or the local dev server.
- **Pages must exist before the deploy workflow runs**, or it fails with "Get
  Pages site failed". The workflow now sets `enablement: true` and bootstraps
  itself.
- **HTTPS enforcement can't be switched on until the certificate exists**, and
  the certificate needs working DNS. Attempting it early returns a confusing
  "The certificate does not exist yet" 404.
- **A stuck GitHub Pages certificate is fixed by removing and re-adding the
  custom domain.** Ours sat unissued for two hours with DNS reporting valid and
  HTTPS-eligible. Setting `cname` to empty, waiting twenty seconds, then
  setting it back produced `state: approved` immediately. GitHub's documented
  "up to 24 hours" is not the whole story — it can simply be stuck. Don't
  repeat this more than once or twice, because Let's Encrypt rate-limits
  duplicate certificate requests.
- **Don't pass a `sb_publishable_` key as `Authorization: Bearer`.** It isn't a
  JWT. It belongs in the `apikey` header; `Bearer` carries a user's session JWT.

---

## Owed by the owner

- [x] GitHub account, logged in as `idanl3`
- [x] Supabase project created
- [x] DNS record for `pip.linnewiel.com`
- [x] Database password in `.env`
- [x] Scoped Supabase access token in `.env`
- [ ] **Custom SMTP for Supabase auth emails.** The built-in mailer allows only
      a handful of messages per hour and Supabase does not intend it for
      production. Magic links are the whole login, so without this a family
      waiting on a link may simply never get one. Resend's free tier is ample
      for five families. Needed before real families are invited, not before
      the next build step.
- [ ] ElevenLabs API key and the English agent ID — needed for phase 3
- [ ] Test each phase and report back

### Low priority tidy-ups

- The Supabase project is named `idanl3@yahoo.com's Project`. Renaming it to
  `pip` would be tidier. Not exposed publicly anywhere, so this is cosmetic.

---

## Keeping this file honest

Update it at every phase checkpoint, and whenever something surprising is
learned. A stale handover file is worse than none, because it gets believed.
Decisions go in `DECISIONS.md`, not here — this file is state, that one is
reasoning.
