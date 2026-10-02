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

  // Reopening asks for a PIN now: these answers describe the children, and a
  // child should not be able to read them by picking up the tablet. This
  // context has no PIN yet, so the gate offers to set one.
  await page.goto('/onboarding.html');
  await expect(page.locator('#stage-pin [data-pin-heading]')).toHaveText(/choose a parent pin/i);
  for (const digit of '481902') {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');

  const reopened = page.locator('#children > .child').nth(0);
  await expect(reopened.locator('.js-name')).toHaveValue('Dalet');
  await expect(reopened.locator('.js-age')).toHaveValue('8');

  // The chip is ticked again, intact, and the typed words are back in the box
  // rather than merged into the chips.
  await expect(
    reopened.locator('.js-personality-chips input:checked'),
  ).toHaveValue(commaTrait);
  await expect(reopened.locator('.js-personality-other')).toHaveValue('Loves drawing');

  expect(errors).toEqual([]);
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
  await page.getByRole('link', { name: 'Parents' }).click();
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

  // Their own answers came back.
  const block = page.locator('#children > .child').nth(0);
  await expect(block.locator('.js-personality-other')).toHaveValue('Collects stones');

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
  // The other child was not rewritten, and this one kept what was not edited.
  expect(rows[1].personality).toBe('Collects stones');
  // Any change to a child means a fresh look.
  expect(rows[0].status).toBe('pending');

  expect(errors).toEqual([]);
});
