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
const DEFAULTS = {
  children:
    'No profile was provided for this conversation. Ask each child their name and roughly how old they are, warmly and briefly, before you begin.',
  parent_names: 'your grown-up',
  children_in_session: 'not specified - ask who was part of what happened',
  parent_context: 'nothing was said in advance',
  recurring_conflicts: 'none noted',
  house_rules: 'none noted',
  extra_care: 'nothing noted',
};

const END_CALL = {
  type: 'system',
  name: 'end_call',
  description: '',
  params: { system_tool_type: 'end_call' },
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

const declared = new Set([...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
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
  ['no child profile in the live prompt', !/Name: \w+, age \d+\. Personality:/.test(live.prompt)],
  ['model unchanged', live.llm === before.conversation_config.agent.prompt.llm],
  ['voice unchanged', after.conversation_config.tts.voice_id === before.conversation_config.tts.voice_id],
  ['recording still off', after.platform_settings.privacy.record_voice === false],
  ['retention still 7 days', after.platform_settings.privacy.retention_days === 7],
  ['max duration still 900', after.conversation_config.conversation.max_duration_seconds === 900],
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
