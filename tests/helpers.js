/**
 * Test fixtures that need database access.
 *
 * The browser tests drive the real site against the real Supabase project.
 * There is no local database: Supabase's local stack needs Docker, and the
 * thing worth testing is the behaviour of the actual policies and triggers,
 * which a mock would not reproduce.
 *
 * Everything created here is labelled so cleanup can find it, and cleanup runs
 * even when a test fails.
 */

export const TEST_PASSWORD = 'e2e-test-password';
export const TEST_EMAIL_PREFIX = 'pip-e2e-';
const INVITE_LABEL = 'e2e test';

function projectRef() {
  return new URL(process.env.VITE_SUPABASE_URL).host.split('.')[0];
}

export async function sql(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef()}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );

  if (!response.ok) {
    throw new Error(`SQL failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

/** A fresh, unused invitation code. */
export async function createInvite() {
  const rows = await sql(`
    insert into public.invites (code, label)
    values (public.generate_invite_code(), '${INVITE_LABEL}')
    returning code
  `);
  return rows[0].code;
}

export function testEmail() {
  return `${TEST_EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e4)}@pip.invalid`;
}

/**
 * Puts an account on the admin roster.
 *
 * Only reachable with database credentials, because public.admins has no
 * grants and no policies - which is the point of it. An admin roster the
 * application could edit would not be worth much.
 */
export async function promoteToAdmin(email) {
  await sql(`
    insert into public.admins (user_id)
    select id from auth.users where lower(email) = lower('${email}')
    on conflict (user_id) do nothing
  `);
}

/** The family row belonging to an account, read straight from the database. */
export async function familyOf(email) {
  const rows = await sql(`
    select f.status, f.review_note, f.monthly_minute_limit
      from public.families f
      join auth.users u on u.id = f.owner_id
     where lower(u.email) = lower('${email}')
  `);
  return rows[0];
}

/** Removes everything the tests created. Safe to call repeatedly. */
export async function cleanupTestData() {
  // Deleting the accounts takes their families and children with them, and
  // drops them off the admin roster, both by cascade.
  await sql(`delete from auth.users where email like '${TEST_EMAIL_PREFIX}%'`);

  // Invitations made directly by the fixtures, and any the admin test created
  // through the interface, which label themselves E2E-INVITE-<timestamp>.
  await sql(`
    delete from public.invites
     where label = '${INVITE_LABEL}'
        or label like 'E2E-%'
  `);
}

/**
 * Console noise that is known-benign, with the reason.
 *
 * Nothing goes in here to make a test pass. This list earns its keep only
 * because the strict check has already found two real bugs - a missing
 * favicon and a policy silently discarding every inline style - and a check
 * that gets switched off finds nothing.
 */
const IGNORED = [
  {
    // LiveKit's signalling socket closes without a clean handshake when the
    // page ends the call, and the SDK logs that at error level. It appears
    // during teardown, by which point the conversation has already done its
    // job. If it happened mid-conversation the session would not have
    // connected, and the assertions above would fail first.
    pattern: /WS closed unexpectedly|error reading from signal stream/,
    why: 'the voice SDK logging its own websocket teardown',
  },
];

/**
 * Collects anything the browser logged as an error.
 *
 * Attach this to every test. A page whose script throws on load still renders
 * its markup and still returns HTTP 200, so without watching the console a
 * completely dead page looks like a passing one. That has already happened
 * once on this project.
 */
export function watchForErrors(page) {
  const errors = [];

  const record = (line) => {
    const ignored = IGNORED.find((entry) => entry.pattern.test(line));

    // Echoed as it happens, not only when the final assertion runs. A test
    // that fails earlier - on a timeout, say - otherwise throws away the one
    // console message that explains why, and debugging turns into guesswork.
    // Ignored lines are still printed, so nothing is hidden.
    console.log(`    [browser]${ignored ? ' (ignored)' : ''} ${line}`);

    if (!ignored) errors.push(line);
  };

  page.on('pageerror', (error) => record(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') record(`console: ${message.text()}`);
  });
  return errors;
}
