import { test, expect } from '@playwright/test';
import {
  sql,
  createInvite,
  cleanupTestData,
  testEmail,
  watchForErrors,
  TEST_PASSWORD,
} from './helpers.js';

/**
 * The journey a family actually takes: open the invitation link, create an
 * account, describe the children, submit for approval.
 *
 * This file exists because of two bugs that reached the owner. A deploy went
 * out with no Supabase configuration, so every page returned HTTP 200 and none
 * of them worked. And the "Add another child" button was rendered without a
 * click handler, so it looked enabled and did nothing. Both would have been
 * caught by loading the page once in a browser.
 */

test.afterAll(cleanupTestData);

test('a family joins by invitation and submits a profile', async ({ page }) => {
  const errors = watchForErrors(page);
  const code = await createInvite();
  const email = testEmail();

  await page.goto(`/join.html?code=${code}`);

  // The link carried the code, so the field should be filled and out of sight.
  await expect(page.locator('#code-field')).toBeHidden();
  await expect(page.locator('#code')).toHaveValue(code);

  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');

  await page.waitForURL('**/onboarding.html');

  // Two blocks to begin with: siblings are the common case and an empty page
  // is harder to start from.
  const children = page.locator('#children > .child');
  await expect(children).toHaveCount(2);

  // The bug. The button was present and inert.
  await page.click('#add-child');
  await expect(children).toHaveCount(3);

  // And removing one again.
  await children.nth(2).locator('.js-remove').click();
  await expect(children).toHaveCount(2);
  await page.click('#add-child');
  await expect(children).toHaveCount(3);

  // What the children call their parents.
  await page.locator('#parent-chips .chip', { hasText: 'Dad' }).click();
  await page.fill('#parent-other', 'Ima');

  const kids = [
    { name: 'Alef', age: '9', trait: 'Sensitive - feels things deeply' },
    { name: 'Bet', age: '7', trait: 'Strong sense of fairness, notices anything uneven' },
    { name: 'Gimel', age: '5', trait: 'Easily overwhelmed by noise and commotion' },
  ];

  for (const [index, kid] of kids.entries()) {
    const block = children.nth(index);
    await block.locator('.js-name').fill(kid.name);
    await block.locator('.js-age').fill(kid.age);
    await block.locator('.js-personality-chips .chip', { hasText: kid.trait }).click();
    await block
      .locator('.js-conflict-chips .chip', { hasText: 'Gives in quickly to keep the peace' })
      .click();
  }

  // The heading should follow the name as it is typed.
  await expect(children.nth(0).locator('.child__number')).toHaveText('Alef');

  await page.locator('#recurring-chips .chip', { hasText: 'Bedtime' }).click();
  await page.locator('#rules-chips .chip', { hasText: 'No hitting' }).click();
  await page.fill('#extra-care', 'A new baby arrived recently.');

  await page.click('#submit');
  await page.waitForURL('**/home.html');

  await expect(page.locator('#waiting-title')).toHaveText(
    /waiting for admin to approve you/i,
  );

  // And no child's name appears on this screen at all, which is the point of
  // moving the profile behind the PIN.
  for (const name of ['Alef', 'Bet', 'Gimel']) {
    await expect(page.locator('body')).not.toContainText(name);
  }

  // Nothing may be startable before approval.
  await expect(page.locator('#ready')).toBeHidden();

  // And the database should agree with the screen.
  const rows = await sql(`
    select f.status, f.parent_names::text as parents, count(c.id)::int as kids
      from public.families f
      join auth.users u on u.id = f.owner_id
      left join public.children c on c.family_id = f.id
     where u.email = '${email}'
     group by f.status, f.parent_names
  `);
  expect(rows[0].status).toBe('pending');
  expect(rows[0].kids).toBe(3);
  expect(rows[0].parents).toContain('Ima');

  expect(errors).toEqual([]);
});

test('the saved profile comes back intact when reopened', async ({ page }) => {
  const errors = watchForErrors(page);
  const code = await createInvite();
  const email = testEmail();

  await page.goto(`/join.html?code=${code}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  const children = page.locator('#children > .child');
  await children.nth(1).locator('.js-remove').click();

  const block = children.nth(0);
  await block.locator('.js-name').fill('Dalet');
  await block.locator('.js-age').fill('8');

  // A suggestion containing a comma, plus words of their own. These share one
  // database column, and the round trip is the thing being tested: splitting
  // on commas instead of semicolons would tear the suggestion in half.
  const commaTrait = 'Shy with new people, slow to warm up';
  await block.locator('.js-personality-chips .chip', { hasText: commaTrait }).click();
  await block.locator('.js-personality-other').fill('Loves drawing');

  await page.locator('#parent-chips .chip', { hasText: 'Mum' }).click();
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  // Reopening asks for a PIN: these answers are for Pip, not for children.
  // This context has no PIN yet, so the gate offers to set one.
  await page.goto('/onboarding.html');
  await expect(page.locator('#stage-pin [data-pin-heading]')).toHaveText(/choose a parent pin/i);
  for (const digit of '481902') {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');

  // The children are not on this screen at all any more - they live in the
  // portal, and open one at a time - so nothing about Dalet is readable here.
  await expect(page.locator('#children > .child')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Dalet');
  await expect(page.locator('body')).not.toContainText('Loves drawing');

  // And the household boxes start empty, so a parent rewrites an answer
  // instead of editing one they can read.
  await expect(page.locator('#recurring-other')).toHaveValue('');
  await expect(page.locator('#extra-care')).toHaveValue('');
  await expect(page.locator('#parent-chips input:checked')).toHaveCount(0);

  // Saving an untouched form must change nothing. Empty means "leave this as
  // it is": the alternative erases three answers for a parent who came to
  // change one.
  await page.click('#submit');
  await page.waitForURL('**/parents.html');

  const [row] = await sql(`
    select c.personality, f.parent_names::text as parents
      from public.children c
      join public.families f on f.id = c.family_id
      join auth.users u on u.id = f.owner_id
     where u.email = '${email}'
  `);
  expect(row.personality).toBe(`${commaTrait}; Loves drawing`);
  expect(row.parents).toContain('Mum');

  expect(errors).toEqual([]);
});

/**
 * Rewriting the household answers, blind.
 *
 * The boxes are empty on purpose - a parent writes a fresh answer rather than
 * editing one they can read - so the rule has to be that an empty box leaves
 * what is stored alone, and anything written replaces it.
 */
test('writing one household answer leaves the others alone', async ({ page }) => {
  const email = testEmail();

  await page.goto(`/join.html?code=${await createInvite()}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  const children = page.locator('#children > .child');
  await children.nth(1).locator('.js-remove').click();
  await children.nth(0).locator('.js-name').fill('Nun');
  await children.nth(0).locator('.js-age').fill('7');
  await page.locator('#parent-chips .chip', { hasText: 'Mum' }).click();
  await page.locator('#rules-chips .chip', { hasText: 'No hitting' }).click();
  await page.fill('#extra-care', 'A new baby arrived recently.');
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  // Back in, and only one answer is written.
  await page.goto('/onboarding.html');
  await expect(page.locator('#stage-pin [data-pin-heading]')).toHaveText(/choose a parent pin/i);
  for (const digit of '481902') {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');

  await page.fill('#extra-care', 'The baby is settled now.');
  await page.click('#submit');
  await page.waitForURL('**/parents.html');

  const [row] = await sql(`
    select f.extra_care, f.house_rules, f.parent_names::text as parents
      from public.families f
      join auth.users u on u.id = f.owner_id
     where u.email = '${email}'
  `);
  expect(row.extra_care).toBe('The baby is settled now.');
  // Untouched, from boxes that were never filled in.
  expect(row.house_rules).toContain('No hitting');
  expect(row.parents).toContain('Mum');
});

test('every page loads without a script error', async ({ page }) => {
  // The cheapest possible guard against the dead-deploy failure: a page whose
  // module throws on load still serves its markup and still returns 200.
  for (const path of ['/index.html', '/join.html', '/404.html']) {
    const errors = watchForErrors(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(errors, `${path} logged errors`).toEqual([]);
  }
});

test('an invitation code only works once', async ({ page }) => {
  const code = await createInvite();

  await page.goto(`/join.html?code=${code}`);
  await page.fill('#email', testEmail());
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  // A second family trying the same link gets refused, and is told the code is
  // the problem rather than their account.
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());

  await page.goto(`/join.html?code=${code}`);
  await page.fill('#email', testEmail());
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');

  await expect(page.locator('#notice')).toContainText(/did not work/i);
  await expect(page.locator('#code-field')).toBeVisible();
});

/**
 * Fixing one child's answers without touching the others.
 *
 * Correcting an age used to mean reopening the whole form: every child's
 * description on screen to change one number, and every answer written back
 * over itself. This proves the narrow path - one child in, one child written,
 * the others untouched - and that the family still goes back for review.
 */
test("a parent can change one child without touching the others", async ({ page }) => {
  const errors = watchForErrors(page);
  const email = testEmail();

  await page.goto(`/join.html?code=${await createInvite()}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  const children = page.locator('#children > .child');
  await children.nth(0).locator('.js-name').fill('Chet');
  await children.nth(0).locator('.js-age').fill('9');
  await children.nth(1).locator('.js-name').fill('Tet');
  await children.nth(1).locator('.js-age').fill('6');
  await children.nth(1).locator('.js-personality-other').fill('Collects stones');
  await page.locator('#parent-chips .chip', { hasText: 'Mum' }).click();
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  // Approved, so that the edit has a status to knock back down.
  await sql(`
    update public.families set status = 'approved'
     where owner_id = (select id from auth.users where email = '${email}')
  `);

  // --- into the portal ----------------------------------------------------
  // The launch screen carries one button and a word in the corner.
  await page.reload();
  await expect(page.locator('#ready')).toBeVisible();
  await page.getByRole('link', { name: 'Parents', exact: true }).click();
  await page.waitForURL('**/parents.html');

  // No PIN on this device yet, so the gate offers to choose one.
  await expect(page.locator('#stage-pin [data-pin-heading]')).toHaveText(/choose a parent pin/i);
  for (const digit of '481902') {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');
  await page.waitForSelector('#portal:not(.hidden)');

  // Names and ages, and nothing a child should not read over a shoulder.
  const row = page.locator('.kid-row', { hasText: 'Tet' });
  await expect(row).toContainText('6');
  await expect(page.locator('#kids')).not.toContainText('Collects stones');

  // --- one child ----------------------------------------------------------
  await row.getByRole('link', { name: 'Change' }).click();
  await page.waitForURL(/onboarding\.html\?child=/);
  await page.waitForSelector('#form-area:not(.hidden)');

  // Only that child, and none of the family-wide questions.
  await expect(page.locator('#children > .child')).toHaveCount(1);
  await expect(page.locator('#form-title')).toHaveText('About Tet');
  await expect(page.locator('#parent-chips')).toBeHidden();
  await expect(page.locator('#extra-care')).toBeHidden();
  await expect(page.locator('#add-child')).toBeHidden();

  // Name and age came back, because the portal shows those anyway and you
  // need them to know whose page this is.
  const block = page.locator('#children > .child').nth(0);
  await expect(block.locator('.js-name')).toHaveValue('Tet');
  await expect(block.locator('.js-age')).toHaveValue('6');

  // What was written about them did not. No screen displays it, which is the
  // only reliable way to stop a child reading it over a shoulder.
  await expect(block.locator('.js-personality-other')).toHaveValue('');
  await expect(block.locator('.js-personality-chips input:checked')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Collects stones');

  // Correcting the age must not erase the description that was never shown.
  await block.locator('.js-age').fill('7');
  await page.click('#submit');
  await page.waitForURL('**/parents.html');

  // --- what the database says --------------------------------------------
  const rows = await sql(`
    select c.first_name, c.age, c.personality, f.status
      from public.children c
      join public.families f on f.id = c.family_id
      join auth.users u on u.id = f.owner_id
     where u.email = '${email}'
     order by c.sort_order
  `);

  expect(rows.map((r) => [r.first_name, r.age])).toEqual([
    ['Chet', 9],
    ['Tet', 7],
  ]);
  // The other child was not rewritten, and this one kept the description that
  // the form never showed and never asked about.
  expect(rows[1].personality).toBe('Collects stones');
  // Any change to a child means a fresh look.
  expect(rows[0].status).toBe('pending');

  expect(errors).toEqual([]);
});

/**
 * The microphone check, where it belongs.
 *
 * A phone that will not give up its microphone is a twenty-minute problem, and
 * the kids' screen is the worst place to find that out - a fight is already
 * happening. So the portal offers the check, and the launch screen says so
 * until it has passed once.
 *
 * Playwright grants the microphone without asking, so this can only prove the
 * happy path and the wiring. The refusal branches are unreachable from any
 * browser test, which is the whole reason they spell out what to do.
 */
/** An approved family, signed in, on the launch screen. */
async function approvedFamily(page, name = 'Yod') {
  const email = testEmail();
  await page.goto(`/join.html?code=${await createInvite()}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  const children = page.locator('#children > .child');
  await children.nth(1).locator('.js-remove').click();
  await children.nth(0).locator('.js-name').fill(name);
  await children.nth(0).locator('.js-age').fill('8');
  await page.locator('#parent-chips .chip', { hasText: 'Mum' }).click();
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  await sql(`
    update public.families set status = 'approved'
     where owner_id = (select id from auth.users where email = '${email}')
  `);
  return email;
}

/** Into the portal, past the PIN gate, which has none set on a fresh context. */
async function openPortal(page) {
  await page.getByRole('link', { name: 'Parents', exact: true }).click();
  await page.waitForURL('**/parents.html');
  for (const digit of '481902') {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');
  await page.waitForSelector('#portal:not(.hidden)');
}

test.describe('before the microphone has been granted', () => {
  // Every other context in this suite is handed the microphone, which is what
  // lets a test hold a real conversation and is also what hides this entirely.
  test.use({ permissions: [] });

  /**
   * The microphone check, where it belongs.
   *
   * A phone that will not give up its microphone is a twenty-minute problem,
   * and the kids' screen is the worst place to find that out: a fight is
   * already happening. So the portal offers the check and the launch screen
   * mentions it until it has passed once.
   */
  test('a parent can check the microphone before they need it', async ({ page }) => {
    const errors = watchForErrors(page);

    // Without the browser's own grant control, which is the path every
    // browser that does not have <usermedia> takes. The test for the control
    // itself is below; this one is our fallback button.
    await page.addInitScript(() => {
      delete window.HTMLUserMediaElement;
    });

    await approvedFamily(page);

    // The launch screen says so, before anyone has needed it.
    await page.reload();
    await expect(page.locator('#mic-nudge')).toBeVisible();

    await openPortal(page);
    await expect(page.locator('#mic-state')).not.toHaveText(/pip can hear you/i);

    // Chrome is launched with a fake capture device, so the check succeeds
    // here however the context's permissions are set. What is being proved is
    // the wiring: the check runs, it records the result, and both screens stop
    // asking.
    await page.getByRole('button', { name: /check the microphone/i }).click();
    await expect(page.locator('#mic-state')).toHaveText(/pip can hear you/i);
    await expect(page.locator('#mic-help')).toBeHidden();

    await page.goto('/home.html');
    await page.waitForSelector('#ready:not(.hidden)');
    await expect(page.locator('#mic-nudge')).toBeHidden();

    expect(errors).toEqual([]);
  });

  /**
   * A refusal is a list of steps, not a sentence.
   *
   * No browser in this suite will actually refuse - the fake capture device
   * answers every request, which is the whole reason the owner's phone found a
   * bug none of these tests could. So the refusal is injected: getUserMedia is
   * replaced with one that rejects exactly as a blocked browser does, and
   * everything after that is the real code path.
   */
  /**
   * Chrome 151 ships <usermedia>: a button the browser renders and owns.
   *
   * A tap on it is a trusted signal of intent, so Chrome shows its prompt even
   * where it has decided to suppress script-triggered ones - and a refusal
   * with no visible prompt, on a site the browser still calls 'prompt' rather
   * than 'denied', is what that suppression looks like from in here.
   *
   * The grant itself cannot be driven from a test: the prompt is browser
   * chrome, and the fake-device flag does not reach it. What is checked is
   * that the control is the one offered when the browser has it, and that our
   * own button steps aside rather than sitting there as a second, worse
   * option.
   */
  test('the browser owns the grant control where it has one', async ({ page }) => {
    await approvedFamily(page, 'Lamed');
    await openPortal(page);

    const supported = await page.evaluate(() => 'HTMLUserMediaElement' in window);
    test.skip(!supported, 'this browser has no <usermedia> element');

    await expect(page.locator('#mic-grant')).toBeVisible();
    await expect(page.locator('#mic-check')).toBeHidden();

    // Constraints are set on it, which is what makes it a microphone control
    // rather than a camera one. setConstraints({ audio: true }) is rejected by
    // Chrome - each kind wants a constraint object - so this would throw if
    // the wiring regressed.
    expect(await page.evaluate(() => {
      try {
        document.querySelector('#mic-grant').setConstraints({ audio: {} });
        return 'accepted';
      } catch (error) {
        return `${error.name}: ${error.message}`;
      }
    })).toBe('accepted');
  });

  test('a refused microphone is explained as steps', async ({ page }) => {
    await page.addInitScript(() => {
      // Our own button and our own written steps, which is what a browser
      // without <usermedia> gets. The browser-owned control is covered above.
      delete window.HTMLUserMediaElement;
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });

    await approvedFamily(page, 'Kaf');
    await openPortal(page);
    await page.getByRole('button', { name: /check the microphone/i }).click();

    const help = page.locator('#mic-help');
    await expect(help).toBeVisible();
    await expect(help.locator('.mic__heading')).toContainText(/microphone/i);
    // Steps, because this is read on a phone by somebody who is not a computer
    // person. A paragraph naming three settings screens is one nobody finishes.
    expect(await help.locator('.mic__steps li').count()).toBeGreaterThan(1);
    // And the line that makes a text message from a parent into a bug report.
    await expect(help.locator('.mic__detail')).toContainText('NotAllowedError');

    // Nothing was recorded as granted, so the launch screen still says so.
    await page.goto('/home.html');
    await page.waitForSelector('#ready:not(.hidden)');
    await expect(page.locator('#mic-nudge')).toBeVisible();
  });
});

/**
 * Adding and removing a child, from the portal.
 *
 * Both used to live on the whole-family form, which no longer carries the
 * children at all. Adding reuses the single-child page, so a new child's
 * description is written in the one place a description is ever shown.
 */
test('children can be added and removed from the portal', async ({ page }) => {
  const errors = watchForErrors(page);
  const email = testEmail();

  await page.goto(`/join.html?code=${await createInvite()}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');

  const children = page.locator('#children > .child');
  await children.nth(0).locator('.js-name').fill('Samekh');
  await children.nth(0).locator('.js-age').fill('9');
  await children.nth(1).locator('.js-name').fill('Ayin');
  await children.nth(1).locator('.js-age').fill('6');
  await page.locator('#parent-chips .chip', { hasText: 'Mum' }).click();
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  await page.goto('/parents.html');
  for (const digit of '481902') {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');
  await page.waitForSelector('#portal:not(.hidden)');
  await expect(page.locator('.kid-row')).toHaveCount(2);

  // --- adding ------------------------------------------------------------
  await page.getByRole('link', { name: 'Add another child' }).click();
  await page.waitForURL(/onboarding\.html\?child=new/);
  await page.waitForSelector('#form-area:not(.hidden)');

  // One blank child, and nothing about the household.
  await expect(page.locator('#children > .child')).toHaveCount(1);
  await expect(page.locator('#form-title')).toHaveText('Another child');
  await expect(page.locator('#extra-care')).toBeHidden();
  await expect(page.locator('#children > .child .js-name')).toHaveValue('');

  const block = page.locator('#children > .child').nth(0);
  await block.locator('.js-name').fill('Pe');
  await block.locator('.js-age').fill('4');
  await block.locator('.js-personality-other').fill('Follows the big ones around');
  await page.click('#submit');
  await page.waitForURL('**/parents.html');
  await expect(page.locator('.kid-row')).toHaveCount(3);

  // --- removing ----------------------------------------------------------
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.kid-row', { hasText: 'Ayin' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.kid-row')).toHaveCount(2);

  const rows = await sql(`
    select c.first_name, c.age, c.personality, f.status
      from public.children c
      join public.families f on f.id = c.family_id
      join auth.users u on u.id = f.owner_id
     where u.email = '${email}'
     order by c.sort_order
  `);
  expect(rows.map((r) => r.first_name)).toEqual(['Samekh', 'Pe']);
  expect(rows[1].personality).toBe('Follows the big ones around');
  // Any change to a child means a fresh look.
  expect(rows[0].status).toBe('pending');

  expect(errors).toEqual([]);
});
