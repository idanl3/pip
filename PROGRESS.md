# Where the project stands

**Last updated:** 2026-10-02

Three files carry the whole handover. Read all of them before doing anything:

| File | What it holds |
| --- | --- |
| `CLAUDE.md` | The brief, and section 12's amendments which **override** it |
| `PROGRESS.md` | This file. What is built, what is next, what is blocked |
| `DECISIONS.md` | Why things are the way they are. Read before changing an approach |

---

## Right now

**Phases 1 to 4 are done.** A family can be invited, join, describe their
children, be approved, and hold a real voice session with Pip. Verified end to
end against the live site, including a conversation with the live agent.

The screens a family touches are four: `home.html` is the launch screen and is
one big **Start** plus the word **Parents** in the corner; `parents.html` is
the portal behind the PIN (status, minutes, children, PIN, admin, sign out);
`onboarding.html` is the family's answers, and the same page opens one child
alone as `?child=<id>`; `pip.html` is the kids' screen, PIN then Pip. Nothing
about a child appears outside the PIN. See decisions 23 to 26.

**Next: phase 5**, minute tracking — the ElevenLabs webhook, usage display and
the scheduled job that also keeps the free-tier project awake.

**Not blocked.** Nothing is needed from the owner to continue.

---

## What is live

| Thing | Where | State |
| --- | --- | --- |
| Site | https://pip.linnewiel.com | Serving over HTTPS, HTTP redirects. Let's Encrypt certificate renews itself; expires 2026-12-30 |
| Repository | https://github.com/idanl3/pip | Public, as the free Pages plan requires |
| Deploy | GitHub Actions, on push to `main` | Working, roughly 20 seconds end to end |
| Supabase | `crlobhzwmqvyqvstvmho`, eu-central-1, Postgres 17.11, free plan | `ACTIVE_HEALTHY`. Auth, Data API and migrations all confirmed working |
| ElevenLabs | English agent `agent_5001m3t0...` | Templated prompt pushed from this repository. `claude-sonnet-5-5`, voice `DODLEQrClDo8wCz460ld`, `end_call` on, 15-minute cap, no audio recorded, 7-day retention |
| ElevenLabs | Hebrew agent `agent_2201m3v2...` | Out of scope. Privacy and duration fixed; prompt untouched |

---

## Phases

| # | Phase | State |
| --- | --- | --- |
| 1 | Project setup, Pages, domain | **Done** |
| 2 | Accounts and onboarding | **Done.** Invite links, login, onboarding form, admin approval screen |
| 3 | Agent templating | **Done.** Prompt templated and pushed, seven variables with defaults, `end_call` enabled, privacy fixed |
| 4 | Sessions, PIN, kids' blob screen | **Done.** Tested with a real conversation through a fake microphone. Launch screen is one Start button; the parent area is a separate PIN-gated portal. Sized and tested for a phone |
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
| `ELEVENLABS_API_KEY` | set | Also set as an edge function secret |
| `ELEVENLABS_AGENT_ID_EN` | set | Also set as an edge function secret |
| `ELEVENLABS_AGENT_ID_HE` | set | Hebrew agent, out of scope; recorded so it need not be looked up |
| `SUPABASE_SECRET_KEY` | **not needed** | Functions read `SUPABASE_SECRET_KEYS`, which the platform injects |

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
| `test-functions.ps1` | Attacks the edge functions. Run after changing either one |
| `npm test` | Browser suite against the dev server. Fast; sees **no** policy |
| `npm run test:built` | Builds, serves `dist/`, tests that. **Sees the real policy — run before committing** |
| `npm run test:live` | Same suite against the deployed site. The only way to catch a stale deploy |
| `verify-deploy.ps1` | Checks the **live** site really works. Run before asking anyone to test |
| `new-invite.ps1` | Creates an invitation and prints the link. For the bootstrap case |
| `make-admin.ps1` | Puts an account on the admin roster. Only route in — that table is API-unreachable |

### The agent

`agent/pip-prompt.template.md` is the source of truth, **not the dashboard**.
Editing the prompt in the ElevenLabs interface will be silently overwritten by
the next push, and worse, nobody will know it diverged — which is exactly how
the live agent came to be missing its whole ending section.

```powershell
node agent/push.mjs            # show what would change, change nothing
node agent/push.mjs --apply    # push, then read it back and verify
```

The push refuses to run if a variable has no default, or if the prompt contains
a hardcoded child profile. After pushing it re-reads the agent and checks ten
things, including that the model, voice, privacy settings and duration cap were
left alone.

It also owns the settings, not just the prompt: the fifteen-minute cap, the
45-second silence timeout, audio recording off and 7-day retention, each with
the reason written beside it.

`agent/migrate-live-prompt.mjs` is history: the one-time script that generated
the template from the live agent. Kept so the provenance of that file is
visible.

### Checking the security still holds

```powershell
.\scripts\test-rls.ps1
```

Creates two real accounts, attacks the schema with them, deletes them again.
Run it after touching any policy, trigger or grant. 28 checks; anything other
than "28 passed, 0 failed" means a rule stopped holding. `test-functions.ps1`
does the same for the edge functions, with 26.

### The database schema

Five tables and one view.

`admins` is the roster of people who may approve families, and has **no grants
and no policies at all**, so it is unreachable through the API — only the
security-definer `is_admin()` can see inside. `invites` is the same: admin-only,
so a parent cannot list or probe for codes.

`families` is one row per parent account. `children` holds a first name, an age
and two short notes, and nothing else — it is the most sensitive table here and
should stay that small. The `gender` column exists but is **not collected**,
because the English prompt never reads it; see decision 14.

`sessions` records when Pip ran and for how long, and deliberately **not which
children took part**. `family_usage` derives minutes used this month from
sessions, so a counter cannot drift out of step.

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
- **Supabase's gateway rejects the CORS preflight when `verify_jwt` is on.** A
  preflight carries no `Authorization` header by design, so the function never
  runs and the browser reports only **"Failed to fetch"**. Deploy with
  `--no-verify-jwt` and check the JWT in the function, which `start-session`
  and `end-session` already do — an anonymous POST still gets a 401 from our
  own code.
- **`Access-Control-Allow-Headers` must list `apikey`.** Supabase requires
  that header on every request. Without it the preflight answers a cheerful
  204 and the browser then refuses the real request, again with only "Failed
  to fetch". Looks perfectly healthy from a script, because scripts send no
  preflight.
- **`service_role` bypasses row-level security but NOT grants.** Two separate
  mechanisms, and only the first is famous. With "automatically expose new
  tables" off it has no grants at all, and every edge function fails with
  `42501 permission denied`, which reaches the parent as "something went
  wrong". Add a line to the grant migration for each new table.
- **This project has legacy API keys disabled.** The `SUPABASE_SERVICE_ROLE_KEY`
  that every example uses is injected into functions and then refused by the
  gateway with a bodyless 401. The usable key arrives as `SUPABASE_SECRET_KEYS`,
  a JSON dictionary; `_shared/clients.ts` handles both.
- **Check `error`, not just `data`.** A failing Supabase query returns null
  data, so code that inspects only `data` reports "no family profile found"
  for a family that plainly exists. A swallowed error becomes a lie about the
  data, and it cost more time than the bug it hid.
- **`spawnSync` on Windows: no good option, so avoid it.** With `shell: true`
  an argument containing spaces is re-split, so `--grep "two words"` becomes
  three arguments. Without a shell, modern Node refuses to spawn a `.cmd` and
  fails silently with no output at all. Run the tool's own CLI through
  `process.execPath` instead, as `scripts/run-tests.mjs` does.
- **PowerShell 5.1 corrupts files two different ways.** `-Encoding utf8`
  writes a **BOM**, and Vite's JSON loader rejects it — that broke the build
  both locally and in CI, with `Unexpected token ''`. npm tolerates a BOM, so
  `npm test` kept working and nothing complained. Then `-Encoding ascii`
  turned an em dash into question marks. **Don't hand-edit JSON from a shell.**
  If you must write a file, use
  `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))`.
- **Inline `style=""` attributes are blocked by the policy and silently do
  nothing.** `style-src 'self'` refuses them; the browser logs "the action has
  been blocked" and the style never applies. It looks perfectly fine on the dev
  server, which injects no policy, and is quietly wrong in production. Use a
  class. Setting styles from JavaScript is fine — the policy governs markup
  attributes and `<style>` elements, not CSSOM.
- **`frame-ancestors` cannot be delivered in a meta tag.** It is ignored and
  logs an error. Removed. The consequence is honest: this site cannot stop
  itself being framed, and fixing that needs a host that can send headers.
- **`npm run test:built` leaves a preview server on port 4173** if a run is
  interrupted, and the next run then refuses to start. Free it with
  `Get-NetTCPConnection -LocalPort 4173 -State Listen` and `Stop-Process`.
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

**A green test suite says nothing about permissions.** Playwright runs Chrome
with `--use-fake-ui-for-media-stream`, which grants the microphone without
asking. That is what lets a test hold a real conversation, and it also means
the suite cannot see a permission prompt that never appears. The owner's
Android phone found that in one tap. Anything permission-shaped has to be
tested on a real device.

**Ask for the microphone inside the tap.** Chrome on Android expires the user
activation from a tap after a few seconds, and then refuses `getUserMedia`
outright instead of prompting. Any network call between the tap and the request
- ours took an auth call, an edge function and a possible cold start - is
enough. `pip.js` asks first and stops the track immediately; see decision 27.

**Test at a phone viewport or do not claim it works on a phone.** Every test
ran at a desktop size for four phases. At 360px wide, plain links were 21px
tall, chips 32px, and the PIN keypad used two thirds of the screen.
`tests/mobile.spec.js` now asserts 44px minimums and no horizontal overflow on
every screen.

**A hidden ancestor is not a hidden element, and `renumber()` will undo you.**
One-child mode hides the family-wide questions by adding `hidden` to two
wrapper divs, which is fine. It also needed `#add-child` hidden - and setting
that before calling `addChild()` did nothing, because `renumber()` runs at the
end of `addChild()` and toggles that same class back off whenever there are
fewer children than the maximum. The toggle now knows about one-child mode.
Anything that fights a function whose whole job is to recompute visibility
will lose.

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
