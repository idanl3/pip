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

/** Removes everything the tests created. Safe to call repeatedly. */
export async function cleanupTestData() {
  await sql(`delete from auth.users where email like '${TEST_EMAIL_PREFIX}%'`);
  await sql(`delete from public.invites where label = '${INVITE_LABEL}'`);
}

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
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}
