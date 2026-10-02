/**
 * Pushes the prompt and settings in this repository to the ElevenLabs agent.
 *
 *     node agent/push.mjs            show what would change, change nothing
 *     node agent/push.mjs --apply    actually push it
 *
 * The repository is the source of truth, not the dashboard. That is the whole
 * point: the live agent was found carrying a prompt that had drifted from the
 * file, missing the section that was meant to stop it listening to the family
 * after saying goodbye. A dashboard nobody diffs is how that happens.
 *
 * Defaults to a dry run. Pushing a bad prompt to an agent that children talk
 * to should take a deliberate flag.
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

/* --- environment --------------------------------------------------------- */

function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && m[2].trim() && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const KEY = process.env.ELEVENLABS_API_KEY;
const AGENT = process.env.ELEVENLABS_AGENT_ID_EN;
const apply = process.argv.includes('--apply');

if (!KEY || !AGENT) {
  console.error('Need ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID_EN in .env.');
  process.exit(2);
}

/**
 * Defaults for the dynamic variables.
 *
 * These are what the agent sees when nobody supplies a profile — talking to it
 * from the ElevenLabs dashboard, for instance. They are deliberately neutral
 * and deliberately not anybody's real family: a default that named real
 * children would leak one family's details into another family's session the
 * first time a variable failed to arrive.
 *
 * Each one is written so the prompt still reads sensibly with it substituted
 * in, rather than leaving Pip describing an empty field.
 */
/**
 * What Pip is told when a family has no practice notes of its own.
 *
 * These are the general rules: true of children in general, and weaker for
 * that. The per-family notes written in the admin screen replace them, and
 * the difference is between "a child who is much younger needs shorter
 * sentences" and "Mai is five, speak to her in very short sentences".
 */
const PRACTICE_NOTES_FALLBACK = [
  'A child who gives in or agrees quickly may be doing it to end the argument rather than because they are happy. Check gently that a solution really works for them, and make sure their own feelings get space, not only everyone else\'s.',
  'A child who is sensitive to fairness will notice anything uneven, including how you treat each child. Keep turns and attention visibly equal. Invite their ideas while problem-solving, but make sure their solutions work for the others too, not only cleverly for themselves.',
  'A child who is much younger than the others, or shy, needs very short and simple sentences and choices rather than open questions, and must not be spoken over. If they get overwhelmed, stop and calm first, and invite the parent to help if they do not settle quickly.',
  'When the conflict is about a parent\'s attention, do not promise anything on the parent\'s behalf. Name the feeling, and mention it in the recap so the parent can follow it up.',
].join('\n');

const DEFAULTS = {
  children:
    'No profile was provided for this conversation. Ask each child their name and roughly how old they are, warmly and briefly, before you begin.',
  parent_names: 'your grown-up',
  children_in_session:
    'nobody was named, so you do not know who is here - ask each child their name and roughly how old they are',
  greeting_names: 'there',
  recurring_conflicts: 'none noted',
  house_rules: 'none noted',
  extra_care: 'nothing noted',

  // The general rules, used for any family whose practice notes have not been
  // written yet. Correct but weaker than the real thing: they describe a kind
  // of child rather than naming one, so Pip has to work out who they apply to.
  // That inference is exactly what was lost when the owner's per-child notes
  // were generalised, and why the age adaptation stopped showing.
  practice_notes: PRACTICE_NOTES_FALLBACK,
};

const END_CALL = {
  type: 'system',
  name: 'end_call',
  description: '',
  params: { system_tool_type: 'end_call' },
};

/**
 * Agent settings this repository owns.
 *
 * These were each set by hand at some point, which means nothing recorded what
 * they should be or why. A setting nobody can diff is how the live prompt came
 * to be missing its entire ending section without anyone noticing, so they
 * belong here with the reasons attached.
 */
/**
 * The line the agent speaks before the model runs.
 *
 * The owner's original, restored verbatim. It names nobody and asks the
 * children who they are, which is how it worked before any of this.
 *
 * The attempts to improve on it both failed, in instructive ways. Greeting
 * them by name and then explaining why Pip was there offered nobody a turn, so
 * two children sat listening to silence - a fixed opening line is spoken and
 * then the agent waits, it does not carry on by itself. Replacing that with
 * "who wants to tell me what happened first?" handed the children a decision
 * that Pip's own stage 2 gives to Pip. And asking "can you hear me okay?"
 * started the conversation outside any stage, so Pip chose its next move fresh
 * and went straight to what happened - skipping the calming stage, because
 * asking for names was what used to carry Pip into it.
 *
 * It ends with a question, names nobody, and leads into stage 1. Leave it
 * alone.
 */
const FIRST_MESSAGE =
  "Hi, I'm Pip! I heard something tricky happened. I'm here to help you both " +
  'figure it out. First, can each of you tell me your name?'

const SETTINGS = {
  // Fifteen minutes. Ten was not headroom: a real session was found cut off
  // mid-mediation at exactly 600 seconds, with a child speaking at 9:42 and
  // Pip answering at 9:47. Being severed with no repair and no goodbye is the
  // worst possible moment to vanish on two upset children.
  maxDurationSeconds: 900,

  // The agent's own silence timeout, which is one of five independent ways a
  // session can end. Long enough that a thinking pause or a child deciding
  // whether to speak does not kill the conversation; short enough that a room
  // everyone has left does not stay connected.
  silenceEndCallSeconds: 45,

  // No audio, ever. The agents were found recording the owner's three children
  // and keeping it with no expiry at all.
  recordVoice: false,

  // Seven days of transcript, chosen by the owner so there is something to
  // look at when they report odd behaviour. Audio is off either way.
  retentionDays: 7,
};

/* --- the request --------------------------------------------------------- */

const prompt = readFileSync('agent/pip-prompt.template.md', 'utf8').replace(/\r\n/g, '\n');

// Refuse to push a prompt that still names a real child. The template is
// generated, but a hand edit could reintroduce one, and this is the last point
// before it reaches a live agent.
if (/Name: \w+, age \d+\. Personality:/.test(prompt)) {
  console.error('Refusing to push: the prompt contains a hardcoded child profile.');
  process.exit(1);
}

const declared = new Set(
  [...`${prompt}
${FIRST_MESSAGE}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]),
);
const missing = [...declared].filter((name) => !(name in DEFAULTS));
if (missing.length) {
  console.error(`Refusing to push: no default for ${missing.join(', ')}.`);
  console.error('A variable with no default renders as literal {{braces}} if it fails to arrive.');
  process.exit(1);
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    ...options,
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} -> ${response.status}\n${await response.text()}`);
  }
  return response.json();
}

const before = await api(`/v1/convai/agents/${AGENT}`);
const livePrompt = before.conversation_config.agent.prompt.prompt;

console.log(`agent          : ${before.name} (${AGENT})`);
console.log(`prompt live    : ${livePrompt.length} chars`);
console.log(`prompt here    : ${prompt.length} chars`);
console.log(`identical      : ${livePrompt === prompt}`);
console.log(`variables      : ${[...declared].join(', ')}`);
console.log(`end_call now   : ${before.conversation_config.agent.prompt.built_in_tools?.end_call ? 'enabled' : 'not enabled'}`);
console.log(`max duration   : ${before.conversation_config.conversation.max_duration_seconds}s -> ${SETTINGS.maxDurationSeconds}s`);
console.log(`silence timeout: ${before.conversation_config.turn.silence_end_call_timeout}s -> ${SETTINGS.silenceEndCallSeconds}s`);
console.log(`record voice   : ${before.platform_settings.privacy.record_voice} -> ${SETTINGS.recordVoice}`);

if (!apply) {
  console.log('\nDry run. Nothing changed. Pass --apply to push.');
} else {

const body = {
  conversation_config: {
    agent: {
      prompt: {
        prompt,
        built_in_tools: { ...before.conversation_config.agent.prompt.built_in_tools, end_call: END_CALL },
      },
      dynamic_variables: { dynamic_variable_placeholders: DEFAULTS },
      first_message: FIRST_MESSAGE,
    },
    conversation: { max_duration_seconds: SETTINGS.maxDurationSeconds },
    turn: { silence_end_call_timeout: SETTINGS.silenceEndCallSeconds },
  },
  platform_settings: {
    privacy: {
      record_voice: SETTINGS.recordVoice,
      retention_days: SETTINGS.retentionDays,
    },
  },
};

await api(`/v1/convai/agents/${AGENT}`, { method: 'PATCH', body: JSON.stringify(body) });

/* --- read it back, because a 200 is not proof ---------------------------- */

const after = await api(`/v1/convai/agents/${AGENT}`);
const live = after.conversation_config.agent.prompt;
const placeholders = after.conversation_config.agent.dynamic_variables?.dynamic_variable_placeholders ?? {};

const checks = [
  ['prompt matches the repository', live.prompt === prompt],
  ['end_call is enabled', Boolean(live.built_in_tools?.end_call)],
  ['all variables have defaults', [...declared].every((n) => n in placeholders)],
  ['the first message is ours', after.conversation_config.agent.first_message === FIRST_MESSAGE],
  [
    'the first message asks something, so the children know to answer',
    (after.conversation_config.agent.first_message ?? '').trim().endsWith('?'),
  ],
  [
    // Asking for names is deliberate. It is what carries Pip into stage 1,
    // which is why removing it quietly stopped the calming happening.
    'the first message still asks who they are',
    /tell me your name/i.test(after.conversation_config.agent.first_message ?? ''),
  ],
  ['no child profile in the live prompt', !/Name: \w+, age \d+\. Personality:/.test(live.prompt)],
  ['model unchanged', live.llm === before.conversation_config.agent.prompt.llm],
  ['voice unchanged', after.conversation_config.tts.voice_id === before.conversation_config.tts.voice_id],
  ['audio recording is off', after.platform_settings.privacy.record_voice === false],
  ['retention is 7 days', after.platform_settings.privacy.retention_days === SETTINGS.retentionDays],
  [
    'maximum duration is 900 seconds',
    after.conversation_config.conversation.max_duration_seconds === SETTINGS.maxDurationSeconds,
  ],
  [
    'the silence timeout is set',
    after.conversation_config.turn.silence_end_call_timeout === SETTINGS.silenceEndCallSeconds,
  ],
];

console.log('');
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed} passed, ${failed} failed`);

// process.exitCode rather than process.exit: exiting abruptly while the fetch
// handles are still closing trips a libuv assertion on Windows and reports a
// nonsense exit code, which would make a failed push look like a crash and a
// successful one look failed.
process.exitCode = failed ? 1 : 0;

} // end of --apply
