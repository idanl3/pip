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

**Phase 1 is complete.** Phase 2 has not started.

**Blocked on:** a Supabase personal access token in `.env`, so the CLI can link
the project and push migrations.

---

## What is live

| Thing | Where | State |
| --- | --- | --- |
| Site | http://pip.linnewiel.com | Serving. HTTPS waiting on the certificate |
| Repository | https://github.com/idanl3/pip | Public, as the free Pages plan requires |
| Deploy | GitHub Actions, on push to `main` | Working, roughly 20 seconds end to end |
| Supabase | project `crlobhzwmqvyqvstvmho`, Frankfurt, free plan | Auth and Data API both confirmed working |
| ElevenLabs | English and Hebrew agents | Configured by hand in the dashboard. **This project has not touched them yet** |

---

## Phases

| # | Phase | State |
| --- | --- | --- |
| 1 | Project setup, Pages, domain | **Done**, except HTTPS enforcement |
| 2 | Accounts and onboarding | Next. Nothing built |
| 3 | Agent templating | Not started. Narrower than the brief says — see `CLAUDE.md` §12 |
| 4 | Sessions, PIN, kids' blob screen | Not started |
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
| `SUPABASE_DB_PASSWORD` | set | Read automatically by the CLI when pushing migrations |
| `SUPABASE_ACCESS_TOKEN` | **empty** | Needed to link the project and deploy functions |
| `ELEVENLABS_API_KEY` | empty | Phase 3 |
| `ELEVENLABS_AGENT_ID_EN` | empty | Phase 3 |
| `SUPABASE_SECRET_KEY` | empty | Only if a function must bypass row-level security |

Tooling: Node 24.19.0, npm 11.17, gh 2.102, Vite 8.3.2, Supabase CLI 2.119.0.
Vite and the Supabase CLI are dev dependencies, not global installs.

---

## Gotchas found the hard way

Each of these cost time. Don't rediscover them.

- **`GET /rest/v1/` returns an empty 401 even when everything is fine.** That
  path serves the OpenAPI spec and is closed by default. It is *not* a sign the
  Data API is off. To test the Data API, request a table that does not exist
  and look for a `PGRST205` error — that proves PostgREST is alive and the key
  was accepted.
- **Free Supabase projects pause after one week of inactivity.** A quiet week
  in a pilot about sibling fights is entirely plausible, and a paused project
  means logins fail. Needs a scheduled ping; pair it with the recap cleanup job
  in phase 5.
- **Free Supabase has no automatic backups.** 500 MB database, 2 project limit.
- **PowerShell blocks `npx.ps1`** with "running scripts is disabled on this
  system". Use `npx.cmd`, or run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **New shells in a session don't see freshly installed tools.** The agent's
  shell captured `PATH` at startup. Refresh it:
  `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')`
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
- **Don't pass a `sb_publishable_` key as `Authorization: Bearer`.** It isn't a
  JWT. It belongs in the `apikey` header; `Bearer` carries a user's session JWT.

---

## Owed by the owner

- [x] GitHub account, logged in as `idanl3`
- [x] Supabase project created
- [x] DNS record for `pip.linnewiel.com`
- [x] Database password in `.env`
- [ ] **Supabase access token in `.env`** — blocking phase 2's migrations
- [ ] ElevenLabs API key and the English agent ID — needed for phase 3
- [ ] Test each phase and report back

---

## Keeping this file honest

Update it at every phase checkpoint, and whenever something surprising is
learned. A stale handover file is worse than none, because it is believed.
Decisions go in `DECISIONS.md`, not here — this file is state, that one is
reasoning.
