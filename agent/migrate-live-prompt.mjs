/**
 * One-time migration: turns the live agent's prompt into the repository's
 * template.
 *
 *     node agent/migrate-live-prompt.mjs <path-to-live-prompt.md>
 *
 * Run once, on 2026-10-02, against the prompt read from the live English
 * agent. After that `agent/pip-prompt.template.md` is the source of truth and
 * this script is history — it is kept so a later session can see exactly how
 * that file came to exist, and what was and was not changed.
 *
 * The owner chose the live text over the local markdown file, so the
 * untouched parts are copied verbatim from the agent rather than retyped. That
 * is the point of doing this in code: the only differences are the ones listed
 * below, and they cannot be accidental.
 *
 * Four changes, and nothing else:
 *
 * 1. The first two lines are dropped. They were notes to a human that had been
 *    pasted into the agent's own instructions:
 *      "Pip - Children's Mediator: System Instructions"
 *      "Paste everything below the line into the platform's system prompt..."
 *    The second had Pip reading an instruction about where to paste things.
 *    The first also carried a double-encoded em dash.
 *
 * 2. The FAMILY PROFILE block becomes dynamic variables. This is the whole
 *    reason for the exercise: the live prompt hardcodes the owner's three
 *    children, so every family would get those three.
 *
 * 3. The unknown-child rule is added, inside that same block. Children's
 *    fights do not respect the database and a cousin in the house is an
 *    ordinary Tuesday.
 *
 * 4. The ENDING THE CONVERSATION section is restored, before STARTING THE
 *    SESSION. The owner wrote it; it never reached the agent. The live prompt
 *    contains no instruction to end a conversation at all, which together with
 *    end_call being disabled is why Pip said goodbye and kept listening.
 *
 * Everything else - the pacing rules, the anti-repetition rules, the ten
 * stages, the age adaptations, difficult moments, the things Pip never does,
 * and the safety section - is copied through unchanged. The live prompt has no
 * blank lines anywhere, so the inserted text has none either.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node agent/migrate-live-prompt.mjs <path-to-live-prompt.md>');
  process.exit(2);
}

const live = readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
const lines = live.split('\n');

/* --- 1. drop the two lines meant for a human ----------------------------- */

if (!/Children's Mediator: System Instructions/.test(lines[0])) {
  console.error(`Unexpected first line: ${lines[0]}`);
  process.exit(1);
}
if (!/Paste everything below the line/.test(lines[1])) {
  console.error(`Unexpected second line: ${lines[1]}`);
  process.exit(1);
}
let out = lines.slice(2);

/* --- 2 and 3. the profile block becomes variables ------------------------ */

const profileStart = out.findIndex((l) => l.startsWith('FAMILY PROFILE'));
const profileEnd = out.findIndex((l) => l.startsWith('WHEN THREE CHILDREN ARE INVOLVED'));

if (profileStart === -1 || profileEnd === -1 || profileEnd < profileStart) {
  console.error('Could not locate the FAMILY PROFILE block.');
  process.exit(1);
}

// Written flat, with no blank lines, to match the surrounding prompt.
const profile = [
  'FAMILY PROFILE (filled in by the parent)',
  'Children:',
  '{{children}}',
  "Parents' names as the children say them: {{parent_names}}",
  'Taking part in this conversation: {{children_in_session}}',
  'What the parent said as they started: {{parent_context}}',
  'Recurring conflicts: {{recurring_conflicts}}',
  'House rules the children know: {{house_rules}}',
  'Anything to handle with extra care: {{extra_care}}',
  'Use this profile quietly. Never say things like "your mom told me you exaggerate." Let it shape what you notice and how you speak.',
  // The unknown-child rule. Placed here so the rest of the prompt is untouched.
  'If a child takes part who is not listed above, you do not know them. Ask their name and at least their age, warmly and briefly, then treat them with the same care as the others and speak to their age the same way. Do not ask them anything else about themselves.',
  // The "what this means in practice" guidance, generalised. The live version
  // named the owner's three children; these are the same four pieces of
  // guidance written so they apply to whichever child they fit.
  'What this profile means in practice:',
  "A child who gives in or agrees quickly may be doing it to end the argument rather than because they are happy. Check gently that a solution really works for them, and make sure their own feelings get space, not only everyone else's.",
  'A child who is sensitive to fairness will notice anything uneven, including how you treat each child. Keep turns and attention visibly equal. Invite their ideas while problem-solving, but make sure their solutions work for the others too, not only cleverly for themselves.',
  'A child who is much younger than the others, or shy, needs very short and simple sentences and choices rather than open questions, and must not be spoken over. If they get overwhelmed, stop and calm first, and invite the parent to help if they do not settle quickly.',
  "When the conflict is about a parent's attention, do not promise anything on the parent's behalf. Name the feeling, and mention it in the recap so the parent can follow it up.",
];

out = [...out.slice(0, profileStart), ...profile, ...out.slice(profileEnd)];

/* --- 4. restore the ending section --------------------------------------- */

const ending = [
  'ENDING THE CONVERSATION',
  "When the conversation is finished, you must actually end it, not just say goodbye. Otherwise you will keep listening to the family's normal life afterward.",
  'After your final goodbye (and the parent recap, if there was one), immediately use the end_call tool to end the conversation.',
  'Also end it if the parent says the session is over, or asks you to stop.',
  'If no one has spoken to you for a while after the conversation seems finished, say a short goodbye and end it.',
  'Never stay in the conversation "just in case." If the family needs you again, they will start a new session.',
];

const startingSession = out.findIndex((l) => l.startsWith('STARTING THE SESSION'));
if (startingSession === -1) {
  console.error('Could not find STARTING THE SESSION to insert before.');
  process.exit(1);
}
out = [...out.slice(0, startingSession), ...ending, ...out.slice(startingSession)];

/* --- 5. fill in the placeholders nobody ever filled in ------------------- */

// Six square-bracket slots for the parent's name were left unfilled in the
// live prompt, in the worst places for it: calling for help when a fight turns
// physical, and the safety disclosure. A model usually infers the real name
// from the profile, but "Let's get [parent name] right now" said literally to
// a frightened child is not a risk worth carrying for the sake of leaving the
// prompt untouched.
//
// Matches [parent], [parent name] and [Parent name]. Deliberately does not
// match [child's name] - see below.
let text = out.join('\n');
const parentSlots = (text.match(/\[[Pp]arent(?: name)?\]/g) ?? []).length;
if (parentSlots !== 6) {
  console.error(`Expected 6 parent placeholders, found ${parentSlots}. Stopping rather than guessing.`);
  process.exit(1);
}
text = text.replace(/\[[Pp]arent(?: name)?\]/g, '{{parent_names}}');

// [child's name] is left exactly as it is, which is a change of plan.
//
// It sits inside a quoted example - "[Parent name], [child's name] shared
// something important" - and it is a slot the model fills from the live
// conversation, since it knows perfectly well which child just spoke. The
// parent's name is data and had to become a variable; this one is not.
// Rewording it would have meant rewriting a sentence in the safety section to
// keep the grammar, and that section is not worth rewriting for tidiness.

// This file is committed to a public repository. Nothing identifying a real
// child may be in it. Failing loudly here is the last line of defence.
//
// Word boundaries matter: a plain substring check for "age 9" matched
// "Stage 9: Celebrate the skill" and refused a perfectly clean template. A
// guard that cries wolf gets switched off, so it has to be exact.
const forbidden = [
  /\bNegev\b/,
  /\bNina\b/,
  /\bMai\b/,
  // The shape of a hardcoded child, whatever the name: the thing being
  // replaced in the first place.
  /Name: \w+, age \d+\. Personality:/,
];
const found = forbidden.filter((pattern) => pattern.test(text));
if (found.length) {
  console.error(`Refusing to write: the template still matches ${found.join(', ')}`);
  process.exit(1);
}

writeFileSync('agent/pip-prompt.template.md', text, 'utf8');

console.log(`wrote agent/pip-prompt.template.md`);
console.log(`  ${text.length} characters, ${out.length} lines`);
console.log(`  variables: ${[...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).join(', ')}`);
