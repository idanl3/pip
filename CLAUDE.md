# Pip — Project Brief for Claude Code

This brief hands over a project that was designed in a separate conversation. Read it fully before starting. Save it as `CLAUDE.md` in the project root so it is loaded in every session.

---

## 1. What we're building

**Pip** is a voice-based mediator that helps children work through conflicts with each other, using each conflict as a chance to grow: calming down, naming feelings, telling their side, listening, solving problems together, and repairing the relationship.

Pip is a **parent helper**, not a replacement for the parent. A parent always starts the session and stays nearby.

Pip already exists as two ElevenLabs voice agents (English and Hebrew), configured manually in the ElevenLabs dashboard and working well in the owner's home. This project turns that into a small **pilot website** for 3–5 families the owner personally selects and approves.

- **Domain:** `pip.linnewiel.com`
- **Languages:** Hebrew (primary) and English. The UI must fully support Hebrew right-to-left layout.
- **Scale:** pilot only, 3–5 families. Keep everything simple, but build it properly.
- **No payments in this phase.** The owner covers ElevenLabs costs; usage is controlled with monthly minute limits.

---

## 2. Your role, Claude Code: you are expected to do the work end to end

The owner is not a developer. You are expected to do all of the following yourself, asking permission before running commands as usual:

- **Write and organize all project files** directly in this folder. The owner should never need to copy or paste code.
- **Run the site locally** so the owner can test it in a browser, and read and fix errors yourself.
- **Use Git and GitHub:** initialize the repository, commit with clear messages, push to GitHub, and set up GitHub Pages deployment.
- **Set up Supabase through its CLI:** create the database tables and security policies through migrations, deploy edge functions, and set function secrets.
- **Configure the ElevenLabs agents through the ElevenLabs API:** update instructions, dynamic variables, privacy settings, and the post-call webhook, instead of asking the owner to change things in the dashboard. Keep the agents' instructions in this repository as the source of truth, with a script that pushes them to ElevenLabs.
- **Explain briefly, in plain language,** what you did at each checkpoint, and tell the owner exactly what they need to test.

**The owner will do only these things,** and you should tell them clearly when each is needed:

1. Create accounts (GitHub, Supabase) and enter any payment details.
2. Log in once to GitHub and Supabase from this computer when you ask.
3. Provide API keys (ElevenLabs API key, Supabase keys) for the private `.env` file and function secrets.
4. Add the DNS record for `pip.linnewiel.com` in their domain provider's dashboard. Give them the exact record to add.
5. Test with their own voice and children, and report how Pip sounds and behaves.

**Important:** APIs and tools change. Before implementing anything with ElevenLabs or Supabase, check their **current documentation** rather than relying on memory, especially for the ElevenLabs web SDK, conversation tokens or signed URLs, dynamic variables, client tools, webhook payloads and signature verification, and privacy and retention settings.

---

## 3. Files the owner will place in this folder

- `pip-mediator-instructions.md`: English agent instructions (current version, with the owner's family profile hardcoded).
- `pip-mediator-instructions-he.md`: Hebrew agent instructions (same content, in Hebrew, with explicit gender rules for the children).

Both must be converted into **templates** (see section 7). These files represent careful design work by the owner. Preserve their content, tone, and structure. Change only what's needed for templating and the new parent flow, and show the owner the diff before pushing changes to ElevenLabs.

---

## 4. Architecture

| Layer | Service | Role |
|---|---|---|
| Website | **GitHub Pages** | Static site (HTML, CSS, JavaScript). Parent area, kids' Pip screen, admin area. |
| Backend | **Supabase** | Parent login, database, row-level security, edge functions. |
| Voice agent | **ElevenLabs** | Pip in English and Hebrew. Voice goes directly between the browser and ElevenLabs. |

Key rules:

- The GitHub repository is **public** (GitHub Pages free plan). **Never commit secrets.** The ElevenLabs API key lives only in Supabase function secrets and the local `.env`, and `.env` must be in `.gitignore`.
- **Voice never passes through our servers.** The browser connects directly to ElevenLabs using a short-lived session token issued by our edge function.
- Keep the frontend simple: plain HTML, CSS, and JavaScript, or a lightweight build tool if clearly needed. Use the ElevenLabs JavaScript client SDK for conversations. Make it an installable web app (manifest and icon) so families can "Add to Home Screen".

---

## 5. Data principles: minimal data

This is a core requirement, not a nice-to-have. Children's data must be minimized everywhere.

**What we store and where:**

| Data | Where | Who can read it |
|---|---|---|
| Parent email, account ID | Supabase | Owner (admin) |
| Approval status, monthly minute limit, usage | Supabase | Owner, and the family sees their own usage |
| Children's profiles (first name, age, gender for Hebrew grammar, personality notes) | Supabase, protected by row-level security | That family, and the owner for approval |
| Session log: start time, duration, which agent | Supabase | Owner, and the family sees their own |
| Session recaps | Supabase, **encrypted in the browser before upload** | **Only the family.** The owner cannot read them. |
| Encryption key | Browser storage on the family's device | The device only |
| Audio | **Nowhere** | — |
| Full transcripts | Not stored on the server. Used in the browser only to build the recap. | — |

**Rules:**
- Collect first names only. No last names, schools, addresses, photos, or birthdates (age is enough).
- Recaps auto-delete after 14 days (configurable). Implement with a scheduled cleanup.
- **ElevenLabs settings** (configure through the API and confirm with the owner): audio recording saving off, conversation retention at the shortest available period. Note: Zero Retention Mode is Enterprise-only, so it's not available for the pilot.
- The **post-call webhook** may include full transcripts. Our webhook function must read only the conversation ID and duration and must not store or log anything else.
- No third-party analytics, trackers, or ad scripts on the site.

---

## 6. Features

### 6.1 Parent accounts and onboarding
- Parent signs up with email (Supabase auth, magic link is fine).
- Guided onboarding form, friendly and clear, in Hebrew or English:
  - Parents' names as the children say them (for example "Mom", "Dad", "אמא", "אבא")
  - Preferred language (Hebrew or English)
  - For each child: first name, age, gender (needed for Hebrew grammar), personality, what they tend to do in conflicts
  - Recurring conflicts, house rules the children know, anything to handle with extra care
- Each question needs helpful examples and short hints, since parents often struggle to describe their children's styles. Model the examples on the family profile in the existing instruction files.
- On submit, the profile goes to **pending approval**. The family cannot start sessions until approved.
- Edits to an approved profile go back to pending approval.

### 6.2 Admin area (owner only)
- List of families with status: pending, approved, needs changes, suspended.
- View a profile, approve it, or send it back with a note the parent sees.
- Set each family's monthly minute limit (default 120).
- View usage per family: minutes this month, session count. No conversation content.
- Suspend a family.
- Restrict admin access securely, for example by an admin flag on the owner's account enforced in row-level security.

### 6.3 Device setup and encryption
- On first use on a device, generate a random encryption key with the browser's Web Crypto API, marked non-extractable, and store it in IndexedDB.
- Request persistent storage from the browser.
- Generate a **recovery code** during setup and ask the parent to save it. Use it to restore the key on a new device or after browser data is cleared.
- Recaps are encrypted with this key before upload and decrypted only in the browser.
- Use an established, well-reviewed approach for key wrapping and recovery. Don't invent cryptography.
- Prompt parents to "Add to Home Screen", explaining that it keeps Pip working reliably, since Safari may clear storage for sites not added to the home screen.
- Warn against private browsing mode.
- Device-to-device transfer by QR code is a later phase; the recovery code covers the pilot.

### 6.4 Parent PIN
- The parent sets a 4–6 digit PIN on each device. Store only a salted hash, locally.
- The PIN is required to start a session and to open the parent area.
- The PIN gates the screen; it is **not** the encryption key.
- Reset the PIN by logging in again with email.

### 6.5 Starting a session (parent mode)
1. Parent enters the PIN.
2. Parent selects which children are involved.
3. Optionally, the parent types one sentence of context, for example "They're fighting over the Lego tower the little one knocked down."
4. Parent taps "Start". The frontend calls the `start-session` edge function with the user's login token.
5. `start-session` checks: family approved, not suspended, monthly limit not reached, and **no other active session for this family**. If all pass, it requests a conversation token or signed URL from ElevenLabs for the correct agent (Hebrew or English) and returns it. It records a session row with a start time.
6. The frontend starts the conversation with the ElevenLabs SDK, passing the family profile, the children involved, the parent's context, and the parents' names as dynamic variables.
7. Set a maximum session length (for example 15 minutes) so a forgotten session can't run up costs.

### 6.6 Kids' Pip screen
- **The visual is an animated, abstract "blob" or orb, not a full avatar.** The children tested the ElevenLabs dashboard's animated blob and loved it, so aim for something with that feeling: soft, organic, colorful, and alive.
- The blob must **react to sound in real time**: gently pulsing or rippling with the children's voices while Pip listens, and moving more expressively while Pip speaks. Use the audio levels the ElevenLabs SDK provides, if available, rather than random animation. Check whether ElevenLabs currently offers a ready-made orb or blob UI component and use it if it fits; otherwise build one (canvas, WebGL, or SVG).
- Clear visual states: waiting to start, Pip listening, Pip talking, and **conversation ended**, which must be visibly different, for example the blob settling and fading, so everyone can see Pip is no longer listening.
- Use Pip's own warm color palette so it feels like Pip, not like ElevenLabs.
- Respect reduced-motion settings with a calmer animation.
- Minimal text, since the youngest child may be 5 and can't read much.
- Correct right-to-left layout in Hebrew.
- An end-session control that only the parent can use (PIN), plus Pip ending naturally (see 6.10).

### 6.7 Safety alert
- If Pip reaches its safety section ("stop and get the parent right away"), the screen should show a clear alert for the parent. Implement this with an ElevenLabs **client tool** (for example `alert_parent`) if the current SDK supports it; otherwise discuss alternatives with the owner.
- Nothing about the alert is sent to our server except, optionally, a flag on the session row that an alert occurred. No content.

### 6.8 End of session and recap
- Pip gives its spoken hand-back and recap to the parent (handled in the agent instructions).
- The browser collects the transcript from SDK events during the session. At the end, it creates a short recap (what happened, what they agreed, one thing to reinforce), encrypts it, uploads it, and discards the transcript.
- Generating the written recap: discuss with the owner. Options include building it from the agent's own final recap message, or a later phase. Do not send transcripts to any additional service without the owner's approval.

### 6.9 Minute tracking
- `elevenlabs-webhook` edge function: verify the webhook signature, read only the conversation ID and duration, update the session row, and add to the family's monthly usage. Store and log nothing else.
- Fallback: if no webhook arrives, close the session using the client-reported end time.
- Show the parent their remaining minutes. Warn when they're low. When the limit is reached, `start-session` refuses with a friendly message.
- Monthly usage resets on the first of each month.

### 6.10 Ending sessions reliably (found in testing: high priority)
In the owner's home test, Pip said goodbye but the conversation stayed open, and it later responded to normal family conversation. This is both a privacy problem and a cost problem. Use several layers so a session always ends:
1. **Agent ends the call itself:** enable ElevenLabs' built-in end-call system tool on both agents. The instruction files now include an "Ending the conversation" section telling Pip to use it after the goodbye.
2. **Silence timeout:** configure the agent to end the conversation after a period of silence, if the current platform settings support it (for example 30–60 seconds with no one speaking after the conversation winds down).
3. **Maximum duration:** keep the session length cap from 6.5.
4. **Client-side backup:** the frontend ends the session if it detects a long silence, if the page is closed or hidden for a while, or when the parent presses end.
5. **Visible ended state:** when a session ends by any route, the screen clearly shows Pip is no longer listening (see 6.6).

Test every route: Pip ending after the goodbye, the silence timeout, the parent ending it, and closing the page.

---

## 7. Agent changes (ElevenLabs)

- Convert the hardcoded family profile in both instruction files into **dynamic variables**, for example parents' names, children (name, age, gender, personality, tendencies), children involved in this session, parent's opening context, recurring conflicts, house rules, and extra care notes. Keep the "what this profile means in practice" guidance general so it applies to any family.
- Add to the instructions:
  - **Parent opening:** Pip briefly acknowledges the parent's context, then turns to the children.
  - **Hand-back:** at the end, Pip addresses the parent by the name the children use and gives the short recap.
  - The **safety client tool** call, alongside Pip's existing spoken safety response.
- Enable the built-in **end-call system tool** on both agents, and configure the silence timeout (see 6.10).
- Keep everything else in the instructions unchanged, including the pacing rules, anti-repetition rules, age adaptations, and the Hebrew gender rules.
- Keep using the current model and voice settings unless the owner asks to change them.
- Show the owner the full diff of instruction changes before pushing them to ElevenLabs.
- Create a script that pushes instructions and settings to both agents from the repository.

---

## 8. Security checklist

- Row-level security on every Supabase table: families see only their own data; admin access is enforced server-side.
- All secrets in Supabase secrets or `.env`, never in the repository.
- Webhook signature verification.
- A strict content security policy on the site, allowing only what's needed (Supabase, ElevenLabs).
- No secrets, tokens, or profile data in browser console logs or URLs.
- Rate-limit `start-session` reasonably.

---

## 9. Build phases and checkpoints

Stop at the end of each phase, tell the owner what was built, and tell them exactly what to test.

1. **Project setup:** repository, folder structure, local development, Supabase project linked, GitHub Pages deploying a placeholder page at `pip.linnewiel.com` (owner adds DNS).
2. **Accounts and onboarding:** login, onboarding form, pending approval, admin approval screen.
3. **Agent templating:** convert both instruction files to templates with dynamic variables, add parent opening and hand-back, push to ElevenLabs after the owner approves the diff, apply privacy settings.
4. **Sessions:** PIN, parent mode, `start-session` function, kids' Pip screen with the animated blob, ElevenLabs conversation in both languages, one-active-session rule, max duration, and all session-ending routes from 6.10.
5. **Minutes:** webhook, usage tracking, limits, parent usage display.
6. **Encryption and recaps:** device key, recovery code, encrypted recaps, auto-deletion.
7. **Safety alert and polish:** client tool alert, Hebrew RTL review, add-to-home-screen flow, final security review.

---

## 10. Out of scope for the pilot

Payments, a native app, passkeys, QR device transfer, languages beyond Hebrew and English, emotion detection, and any public sign-up page. The site should not be indexed by search engines, and new families can only be approved by the owner.

---

## 11. Owner checklist (for reference)

- [ ] GitHub account created
- [ ] Supabase account and project created
- [ ] ElevenLabs API key ready (from the existing account with both agents)
- [ ] Both instruction files placed in the project folder
- [ ] Logged in to GitHub and Supabase when asked
- [ ] DNS record for `pip.linnewiel.com` added when asked
- [ ] Tested each phase and reported back

---

## 12. Amendments — decided 2026-10-01

Decided by the owner after the brief was written. Where these conflict with sections 1–11, **these win.**

**English only for now.** The Hebrew agent and the Hebrew right-to-left interface are out of scope for this stage. Build English-only, but keep it addable later: keep a `language` column on the family, keep interface text in one place instead of scattered through the markup, and don't choose layout that would have to be rebuilt for RTL. `pip-mediator-instructions-he.md` stays in the repo untouched for later.

**Do not rewrite the agent prompt.** `pip-mediator-instructions.md` is good as it stands. The only permitted change is replacing the hardcoded `FAMILY PROFILE` section — and the "what this profile means in practice" notes under it — with dynamic variables filled from the database. Everything else stays byte-identical: pacing, anti-repetition, the stages, age adaptations, difficult moments, safety, ending. This supersedes the prompt additions in section 7 (parent opening, mandatory hand-back).

**The parent recap stays optional.** Stage 10 keeps its current wording — the recap happens only if the parent asks, or if something important came up. Do not make it mandatory. This supersedes section 6.8's assumption of an always-on spoken hand-back.

**Unknown children.** Two or three children per session is correct. If a child takes part who isn't in the family profile — a cousin, a friend, a sibling who was never added — Pip must notice, ask at least their age, and then adapt using the age-adaptation rules already in the prompt. This rule goes **inside the templated profile block**, so the rest of the prompt stays untouched.

**Family-specific text is data, not prompt.** Every family-specific detail in the current instruction file was test data from the owner's own home. All of it comes from the onboarding form and lives in the database, per family.

**The instruction files stay out of the public repository for now.** The repository has to be public for GitHub Pages on the free plan, and git history cannot be unpublished. Both instruction files are therefore gitignored until the family profile inside them is replaced by database-driven variables in phase 3. They remain on the owner's machine. Nothing identifying a child has ever been pushed.
