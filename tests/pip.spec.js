import { test, expect } from '@playwright/test';
import {
  sql,
  createInvite,
  cleanupTestData,
  testEmail,
  watchForErrors,
  promoteToAdmin,
  TEST_PASSWORD,
} from './helpers.js';

/**
 * The kids' screen, including a real conversation with the live agent.
 *
 * This test spends a few seconds of the owner's ElevenLabs minutes, on
 * purpose. Everything cheaper has already been tried and none of it answers
 * the question that matters: whether the content security policy lets the
 * audio pipeline work. The voice SDK builds AudioWorklets from blob URLs and
 * signals over LiveKit, and a policy missing either of those produces a screen
 * that looks like it is connecting and never does. On the dev server, where no
 * policy is injected, it passes perfectly.
 *
 * So: a browser with a fake microphone, a real token, a real connection, and
 * an assertion that Pip actually started listening. Sessions are ended
 * immediately and the family is deleted afterwards.
 */

const PIN = '481902';

/** Taps a PIN into the on-screen keypad. */
async function typePin(page, digits) {
  await page.click('#keypad button[data-key="clear"]');
  for (const digit of digits) {
    await page.click(`#keypad button[data-key="${digit}"]`);
  }
}

test.afterAll(cleanupTestData);

/** An approved family with two children, ready to start a session. */
async function approvedFamily(page) {
  const email = testEmail();
  const code = await createInvite();

  await page.goto(`/join.html?code=${code}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  await page.fill('#parent-other', 'Mum');
  const kids = page.locator('#children > .child');
  await kids.nth(0).locator('.js-name').fill('Alef');
  await kids.nth(0).locator('.js-age').fill('9');
  await kids.nth(1).locator('.js-name').fill('Bet');
  await kids.nth(1).locator('.js-age').fill('7');
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  // Approve it the way the owner would, but without a second browser: the
  // guard lets a server context through, which is what a script is.
  await sql(`
    update public.families set status = 'approved'
     where owner_id = (select id from auth.users where email = '${email}')
  `);

  return email;
}

test('a parent sets a PIN, chooses a child, and Pip actually connects', async ({ page }) => {
  const errors = watchForErrors(page);
  const email = await approvedFamily(page);

  await page.goto('/pip.html');

  // --- the PIN, set for the first time on this device ---------------------
  await expect(page.locator('#stage-pin')).toBeVisible();
  await expect(page.locator('#pin-heading')).toHaveText(/choose a parent pin/i);

  await typePin(page, '1111');
  await page.click('#pin-submit');
  await expect(page.locator('#pin-error')).toContainText(/same digit/i);

  await typePin(page, '1234');
  await page.click('#pin-submit');
  await expect(page.locator('#pin-error')).toContainText(/run of digits/i);

  // Dots, never digits: children are standing next to this screen.
  await typePin(page, PIN);
  await expect(page.locator('#pin-dots .pip__dot')).toHaveCount(PIN.length);
  await page.click('#pin-submit');
  await expect(page.locator('#stage-setup')).toBeVisible();

  // --- choosing who -------------------------------------------------------
  // Two children plus "Someone else", for a cousin or a friend.
  await expect(page.locator('#who .chip')).toHaveCount(3);
  await expect(page.locator('#who')).toContainText('Alef (9)');
  await expect(page.locator('#who')).toContainText('Someone else');

  await page.click('#start');
  await expect(page.locator('#notice')).toContainText(/tap who needs help/i);

  await page.locator('#who .chip', { hasText: 'Alef' }).click();
  await page.locator('#who .chip', { hasText: 'Bet' }).click();

  // --- the conversation ---------------------------------------------------
  await page.click('#start');
  await expect(page.locator('#stage-live')).toBeVisible();
  await expect(page.locator('#blob')).toBeVisible();

  // The assertion this whole test exists for. data-state only leaves
  // "connecting" from onConnect, which fires once WebRTC is up - so reaching
  // it proves the token worked, the policy allowed LiveKit, and the worklets
  // loaded.
  //
  // It reads an attribute rather than any words on screen, because there are
  // deliberately no words: a caption saying "talking" or "listening" flickered
  // and the blob already tells anyone in the room which is which.
  await expect(page.locator('#stage-live')).toHaveAttribute(
    'data-state',
    /listening|speaking/,
    { timeout: 45_000 },
  );

  // And the "getting ready" line gets out of the way once there is a blob.
  await expect(page.locator('#connecting')).toBeHidden();

  // The blob should be painting, not a blank canvas.
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('#blob');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
    return false;
  });
  expect(painted, 'the blob canvas has nothing drawn on it').toBe(true);

  const open = await sql(`
    select s.id, s.ended_at, s.conversation_id
      from public.sessions s
      join public.families f on f.id = s.family_id
      join auth.users u on u.id = f.owner_id
     where u.email = '${email}'
  `);
  expect(open.length, 'no session row was created').toBe(1);
  expect(open[0].ended_at, 'the session was recorded as already ended').toBeNull();
  expect(open[0].conversation_id, 'no conversation id was stored').toBeTruthy();

  // --- the parent finishes it --------------------------------------------
  // No PIN on the way out. Asking for one left Pip talking and listening while
  // it was typed, which is the wrong behaviour and billed by the minute.
  await page.click('#end');

  // The blob settling is the ended state. There is no "All done" panel to
  // acknowledge: it told a grown-up something they had just watched happen and
  // asked them to press a button to leave. The page returns on its own.
  await expect(page.locator('#stage-live')).toHaveAttribute('data-state', 'ended', {
    timeout: 15_000,
  });
  await page.waitForURL('**/home.html', { timeout: 15_000 });

  const closed = await sql(`select ended_at, duration_seconds, duration_source
                              from public.sessions where id = '${open[0].id}'`);
  expect(closed[0].ended_at, 'the session was left open').toBeTruthy();
  expect(closed[0].duration_source).toBe('client');

  expect(errors, 'the browser logged errors during a live conversation').toEqual([]);
});

test('a returning parent is asked for the PIN, not to set one', async ({ page }) => {
  const errors = watchForErrors(page);
  await approvedFamily(page);

  await page.goto('/pip.html');
  await typePin(page, PIN);
  await page.click('#pin-submit');
  await expect(page.locator('#stage-setup')).toBeVisible();

  // Reload: the PIN is stored on the device, so it should now be asked for
  // rather than chosen again.
  await page.reload();
  await expect(page.locator('#pin-heading')).toHaveText(/^parent pin$/i);

  await typePin(page, '999999');
  await page.click('#pin-submit');
  await expect(page.locator('#pin-error')).toContainText(/not the PIN/i);

  await typePin(page, PIN);
  await page.click('#pin-submit');
  await expect(page.locator('#stage-setup')).toBeVisible();

  expect(errors).toEqual([]);
});

test('a family waiting for approval cannot reach the kids screen', async ({ page }) => {
  const code = await createInvite();
  const email = testEmail();

  await page.goto(`/join.html?code=${code}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  await page.fill('#parent-other', 'Mum');
  const kids = page.locator('#children > .child');
  await kids.nth(1).locator('.js-remove').click();
  await kids.nth(0).locator('.js-name').fill('Gimel');
  await kids.nth(0).locator('.js-age').fill('6');
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  await expect(page.locator('#start-card')).toBeHidden();

  // And typing the address directly gets them sent back.
  await page.goto('/pip.html');
  await page.waitForURL('**/home.html');
});
