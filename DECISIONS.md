# Decisions

Append-only. Newest at the bottom. Every entry says what was decided, why, and
what was rejected, so that a later session neither re-argues a settled question
nor quietly undoes a choice that had a reason behind it.

If you disagree with a decision here, say so to the owner. Don't just reverse
it.

---

## 1. English only for the first stage
**2026-10-01 — owner**

The Hebrew agent and the Hebrew right-to-left interface are out of scope for
now. English only.

**Why:** the owner's call, to cut the work in half and get something testable
sooner. Hebrew is still the eventual primary language, so nothing may be built
in a way that makes it expensive to add.

**Consequences:** keep a `language` column on the family from the start. Keep
interface text in one place rather than scattered through markup. Avoid layout
that would need rebuilding for right-to-left.
`pip-mediator-instructions-he.md` stays on disk, untouched, for later.

---

## 2. The agent prompt is not ours to rewrite
**2026-10-01 — owner**

`pip-mediator-instructions.md` is good as it stands. The only permitted change
is replacing the hardcoded `FAMILY PROFILE` section with variables fed from the
database. Everything else stays byte-identical.

**Why:** the prompt is careful design work that already behaves well in real
use at home. The pacing rules, the anti-repetition rules, the age adaptations
and the safety section are load-bearing and were tuned against actual children.

**Rejected:** the brief's section 7 asked for a parent-opening section and a
mandatory hand-back recap. The owner overrode both. **The recap stays
optional** — only when the parent asks, or when something important came up.

---

## 3. Pip must cope with a child it doesn't know
**2026-10-01 — owner**

Two or three children per session. If a child joins who isn't in the family
profile — a cousin, a friend, a sibling nobody added — Pip must notice, ask at
least their age, and adapt using the age-adaptation rules already in the
prompt.

**Why:** children's fights don't respect the database. A guest in the house is
an ordinary Tuesday, and Pip talking to a five-year-old as though they were
nine is a bad experience at exactly the wrong moment.

**Consequences:** this rule goes *inside* the templated profile block, which
keeps decision 2 intact — no edits to the rest of the prompt.

---

## 4. Nothing identifying a child goes into the repository
**2026-10-01**

The repository is public, because GitHub Pages needs that on the free plan.
Both instruction files are therefore gitignored until their family profile is
replaced by database variables.

**Why:** the files carried the owner's three children's first names, ages,
personalities and conflict patterns. Git history cannot be unpublished — a
later commit removing them would leave them in history for anyone who clones.
It would also contradict the project's own data rule, that children's details
live in the database behind row-level security and nowhere else.

**How it was handled:** caught before the first push. The initial commit was
rebuilt so the files never entered history. Two incidental mentions in
`CLAUDE.md` were generalised. Verified with a search across every tree in
every commit.

**Rejected:** a private repository, which would break free Pages; and pushing
as-is, which the owner declined.

---

## 5. Commits are authored with GitHub's noreply address
**2026-10-01**

Local git identity is `idanl3 <101892664+idanl3@users.noreply.github.com>`,
set per-repository.

**Why:** the machine's global git identity belonged to an unrelated account,
which would have misattributed every commit. Using the real email address would
publish it permanently in a public repository's history. GitHub's noreply form
attributes commits to the right account while keeping the address private.

---

## 6. Vite, with pages at the repository root
**2026-10-01**

Plain HTML, CSS and JavaScript, bundled by Vite. Pages at the root, `src/` for
code, `public/` copied through untouched, built to `dist/`.

**Why:** the brief asks for plain files and "a lightweight build tool if
clearly needed". It is needed: the ElevenLabs client SDK is an npm package, and
bundling it is cleaner than loading it from a third-party CDN, which the
content security policy would otherwise have to permit.

---

## 7. The content security policy is injected at build time
**2026-10-01**

The policy lives in `vite.config.js`, not in `index.html`, and is added as a
meta tag during the build only.

**Why:** GitHub Pages cannot send HTTP headers, so a meta tag is the only
option. But a policy strict enough to be worth having blocks the dev server's
inline scripts and hot-reload websocket. Injecting at build time gives a strict
production policy and a working development experience, from one definition.

**Also:** `modulePreload.polyfill` is off, because that polyfill is an inline
script the policy would block.

---

## 8. Supabase is not connected to GitHub
**2026-10-01**

Migrations and functions are deployed from a developer machine with the CLI.
The Supabase GitHub integration is deliberately not installed.

**Why:** the integration's main offering is database branching, which requires
the Pro plan and bills $0.01344 per branch per hour. More importantly, our
repository is public, so auto-deploying on pull requests would let anyone on
the internet trigger the project holding children's profiles. There is one
developer, so there is no coordination problem to solve.

**Kept anyway:** the schema lives in version control as migration files under
`supabase/migrations/`. That is the part that actually matters, and it needs no
integration.

---

## 9. The Supabase CLI is a dev dependency, not a global install
**2026-10-01**

**Why:** it isn't in winget at all, and Supabase does not support installing it
globally through npm. As a dev dependency the version is pinned in
`package-lock.json`, so the repository defines it rather than one machine's
state.

---

## 10. Data API on, automatic table exposure off, automatic RLS on
**2026-10-01**

**Why:** the Data API is what `supabase-js` talks to, and row-level security is
the real boundary either way, so routing every read through an edge function
would add code and latency without adding safety.

The other two settings make mistakes fail safe. With automatic exposure off, a
new table is unreachable from the browser until a migration grants access
explicitly. With automatic row-level security on, a table created without it
cannot end up readable by anyone holding the publishable key — which is public,
baked into the site.

**Consequence to remember when debugging:** a query returning an empty list
instead of an error usually means a missing grant or a missing policy. That is
the design working, not a bug in the page.

**Belt and braces:** migrations still write `grant` and
`enable row level security` explicitly, so the schema is self-documenting and
does not depend on project toggles.

---

## 11. Authentication is invite-only
**2026-10-01 — owner**

No public sign-up. The owner adds a family's email; they receive a magic link.
Login fails for anyone not invited.

**Why:** the brief rules out a public sign-up page and says families arrive
only by the owner's approval. The project was created with signups open,
meaning anyone finding the URL could make an account. Not a breach on its own,
since row-level security and the pending-approval gate gave them nothing, but a
stranger being unable to get an account at all is better than a stranger
getting a useless one.

**Cost:** the owner invites each family by hand. Trivial at three to five
families.

---

## 12. The CLI is not linked; migrations go through the pooler
**2026-10-01**

The Supabase CLI is never linked to the project. Commands pass `--db-url`,
assembled by `scripts/load-env.ps1` from parts kept in `.env`.

**Why:** two reasons, and the second is the one that forces it.

`supabase link` calls `/v1/organizations`, which a project-scoped access token
cannot read. Granting that would have meant a third trip to the dashboard for a
permission nothing else needs.

More importantly, `db.<ref>.supabase.co` resolves to IPv6 only, and the
development machine has no routable IPv6 address, so the direct host is
unreachable whether the CLI is linked or not. Migrations must go through the
pooler regardless.

**How the pooler host was found:** no endpoint this token can read publishes
it. The regional candidates were tried until one authenticated.
`aws-0-eu-central-1` accepts TCP on both ports but rejects the tenant;
`aws-1-eu-central-1` is the one that works. Session mode on port 5432, not
transaction mode on 6543, because migrations need a session.

**Verified:** `supabase migration list` returns cleanly through the assembled
connection string.

**If it breaks later:** the pooler host has moved. Try `aws-0`, `aws-2` and so
on within eu-central-1, keeping the user as `postgres.<project-ref>`.

**Rejected:** granting `Organizations: Read` and `Connection Pooling: Read`
purely to make a convenience command work, when direct endpoint probing showed
everything the project actually needs already returns 200.

---

## 13. Families join by invite link, not by emailed magic link
**2026-10-01 — owner**

The owner hands a family a link containing a one-time code. They open it, pick
a password, and they are in. No email is ever sent.

**Why:** magic links make email deliverability the whole login. Supabase's
built-in mailer allows only a handful of messages an hour and is explicitly not
meant for production, so a family could sit waiting for a link that never
arrives. The owner would rather send the link themselves, which they are doing
anyway to tell the family about Pip.

**Where the rule lives:** in the database, not in a project setting. An account
with no redeemed invitation cannot create a family profile, and without a
family profile an account can do nothing whatsoever. Whether strangers can
register is a dashboard toggle, and a dashboard toggle is not a security
boundary — it can be flipped by accident and nothing in this repository would
notice.

**The code:** twelve characters, about 59 bits, from cryptographically random
bytes rather than `random()`, in an alphabet with no O/0 or I/1 so it survives
being read aloud or retyped. Single use. Thirty-day expiry.

**Deliberately unhelpful on failure:** `redeem_invite` returns true or false
and never says whether a code was wrong, already spent, or expired.
Distinguishing those would make it an oracle for guessing.

**The cost, and it is real:** without a mail server there is no self-service
password reset. A parent who forgets their password needs the owner to reset
it. At three to five families that is a message, not a problem. Adding custom
SMTP later restores it without changing any of this.

---

## 14. Gender is not collected while the project is English only
**2026-10-01 — owner, after checking**

The onboarding form does not ask for a child's gender. The nullable column
stays in the schema.

**Why:** the owner asked whether gender actually reaches the agent, and it does
not. The English prompt mentions gender nowhere at all — not once. It exists
only in the Hebrew file, in the grammatical agreement rule, because Hebrew
inflects verbs and adjectives by gender and Pip cannot form a correct sentence
to a child without it.

With Hebrew out of scope, asking for it would mean holding a data point about a
child that nothing reads. The minimal-data rule is described in the brief as a
core requirement rather than a nice-to-have, so collecting it anyway would be
the wrong call.

**Why keep the column:** it costs nothing empty, and keeping it means adding
Hebrew later needs no migration.

**What it will cost later:** families who signed up before Hebrew exists will
need asking once. At pilot scale that is a single message, and it is the right
trade against holding unused data about children.

---

## 15. No audio saved; conversations kept seven days
**2026-10-02 — owner**

Both agents now have `record_voice` off and `retention_days` set to 7.

**Why it mattered urgently:** the agents were found set to `record_voice: true`
and `retention_days: -1`, meaning ElevenLabs was recording the owner's three
children and keeping it indefinitely. That contradicts the brief, which lists
audio under "nowhere". It had been live throughout the owner's home testing.

**Why seven days rather than the minimum:** the owner wants to be able to see
what Pip actually said when reporting odd behaviour, and a transcript is the
only way to do that. Audio is off either way, so what survives for a week is
text. Worth the trade during a pilot; worth revisiting after it.

**Applied to the Hebrew agent too.** Hebrew is out of scope for building, which
is not a reason to leave children recorded.

**The eight existing conversations were not deleted.** The owner wants them.
They predate the change, so they contain audio, and the new seven-day window
would have removed them around 8 October — so they were downloaded to
`recordings/` instead, which is gitignored. Conversations now live on the
owner's own machine rather than with a vendor, which is the better place for
them.

**`recordings/` must never be committed.** The repository is public and that
folder holds children's voices and the words they said mid-argument. The ignore
rule was written before the folder was created, so there was no window in which
it could have been added.

---

## 16. What the agent audit found, and what is still unfixed
**2026-10-02**

Reading the live agent configuration confirmed the fault the owner saw at home,
and the cause is not in the instructions.

- **`built_in_tools.end_call` is `null`** — the tool is not enabled. The prompt
  tells Pip to use `end_call` after its goodbye, so Pip has been instructed to
  use a tool it does not have. That is exactly why it said goodbye and carried
  on listening to the family.
- **`silence_end_call_timeout` is `-1`** — disabled. No silence timeout either.
- **`max_duration_seconds` is `600`** — a cap does exist, so a forgotten
  session stops after ten minutes rather than running all day.
- `turn_timeout` is 7 seconds.

Both of the first two are fixed in phase 4, with the rest of the
session-ending work in section 6.10. Fixing them is configuration, not a
prompt change.

**Also recorded:** the agent runs `claude-sonnet-5-5`, voice
`DODLEQrClDo8wCz460ld`, a 17,715-character prompt, and no dynamic variables at
all yet. Model and voice stay as they are, per the brief.

---

## 17. Maximum session length raised to fifteen minutes
**2026-10-02 — owner**

`max_duration_seconds` is 900 on both agents, up from 600.

**Why:** the owner noticed a test session had run to nine minutes and thought
ten looked tight. The exported data showed worse than tight. One session ended
with `termination_reason: "Conversation has exceeded maximum duration"` at
exactly 600 seconds, with an active exchange in its final turns — a child
speaking at 9:42 and Pip answering at 9:47, then nothing. Pip was severed
mid-mediation, with no repair stage and no goodbye, which is the worst possible
moment to vanish on two upset children.

Real sessions in the sample ran 454, 525 and 563 seconds, so seven to ten
minutes is normal for a full mediation rather than exceptional. Ten minutes was
not headroom, it was a ceiling being hit. Fifteen is also the figure the brief
suggests.

**What it does not change:** the monthly limit per family still governs cost,
so a longer per-session cap does not raise the monthly ceiling — it only stops
a single mediation being guillotined. The risk it does add is that a stuck
session burns fifteen minutes instead of ten, which is why the session-ending
work in phase 4 matters: `end_call`, a silence timeout, and a client-side
backup.

**Noticed in the same data:** every session except the truncated one ended with
`Client disconnected: 1000`. The browser closed the connection. Pip has never
once ended a conversation itself, which is `end_call` being disabled rather
than anything in the instructions.

---

## 18. The repository is the agent's source of truth, not the dashboard
**2026-10-02**

`agent/pip-prompt.template.md` holds the prompt. `agent/push.mjs` sends it to
ElevenLabs and then reads the agent back to check what actually landed.

**Why:** the live agent was found running a prompt that had drifted from the
file, missing the entire ENDING THE CONVERSATION section — the part written to
stop Pip listening to family life after saying goodbye. Nobody knew, because
nothing ever compared the two. A dashboard that no one diffs is how a fix gets
written and then quietly not applied.

**Consequence to respect:** editing the prompt in the ElevenLabs interface now
means losing that edit at the next push, with no warning. Change the file.

**The push defaults to a dry run.** Sending a bad prompt to an agent that
children talk to should take a deliberate `--apply`. It refuses outright if a
variable has no default, or if the prompt contains a hardcoded child profile.
Afterwards it verifies nine things, among them that the model, the voice, the
privacy settings and the duration cap were left alone — a PATCH that quietly
reset the voice would otherwise be invisible.

**Variable defaults are neutral and are nobody's real family.** A default
naming real children would leak one family's details into another's session
the first time a variable failed to arrive. With no profile supplied the agent
is told to ask each child their name and age instead, so talking to it from the
dashboard still behaves sensibly.

**What this means for dashboard testing:** the agent no longer knows the
owner's children when spoken to directly. The real profile only arrives when a
session starts through the website, in phase 4. Dashboard testing now tests
Pip's behaviour, not Pip's knowledge of a particular family.

---

## 19. Five overlapping ways to end a session
**2026-10-02**

A session ends when any one of these happens, and the rest become no-ops:
Pip's own `end_call`, the agent's fifteen-minute cap, the parent pressing
finish, the page noticing 45 seconds of silence or being hidden for a minute,
and a local timer matching the agent's cap.

**Why so many:** in the owner's own testing Pip said goodbye and then listened
to the family's evening. The exported sessions showed why, conclusively — every
one ended with `Client disconnected: 1000`, meaning the browser closed the
connection. Pip had never ended a conversation in its life, because the
instruction was missing from the live prompt and the tool was disabled.

A single mechanism would have to be the one that never fails. Five that overlap
only need one to work, and `end-session` is idempotent so a double shutdown is
harmless. Overlapping shutdowns are a far better failure than a session nobody
closes.

**The finish button is PIN-gated**, which is the point of a button a child can
see. The test presses it with the wrong PIN first and asserts the session keeps
running.

---

## 20. The blob reacts to real audio, and ended looks ended
**2026-10-02**

The blob is driven by `getInputVolume()` and `getOutputVolume()` from the voice
SDK, not by a timer.

**Why it matters more than it sounds:** children work out within seconds
whether a thing is really listening. A blob pulsing on a loop is a lie they
will catch, and once caught the whole illusion that Pip is paying attention
goes with it.

Levels rise fast and fall slowly, because following the raw level in both
directions makes it flicker on every consonant. The wobble underneath is a sum
of sines rather than noise: a shape that jitters randomly reads as broken, and
the thing has to look like it is breathing.

**Listening and talking move differently enough to tell apart from across a
room**, which is the one piece of information a five-year-old needs and cannot
read.

**Ended is unmistakable.** It settles, shrinks and fades, and the screen waits
1.8 seconds before changing so that cue is not cut short. A blob still
breathing after goodbye would be the visual version of the bug this project
exists to fix.

---

## 21. A browser test holds a real conversation, and that is deliberate
**2026-10-02**

`tests/pip.spec.js` starts a genuine session with the live agent through a fake
microphone, a few seconds at a time, and spends real minutes doing it.

**Why nothing cheaper works:** the voice SDK builds its microphone pipeline as
AudioWorklet modules from blob URLs and signals over LiveKit. A content
security policy missing `script-src blob:` or the LiveKit host produces a screen
that looks like it is connecting and never does — and passes perfectly on the
dev server, which injects no policy at all. The assertion that proves it is
"Pip is listening", because that text is only set from `onConnect`, which only
fires once WebRTC is up.

It found three faults in its first three runs, all invisible locally: the
gateway rejecting the CORS preflight, `apikey` missing from the allowed
headers, and the test runner unable to pass an argument containing a space.

**Cost:** a few pennies per run. Worth it against the alternative, which was
asking the owner to test and having it not work.
