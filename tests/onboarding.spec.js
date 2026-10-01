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
    { name: 'Alef', age: '9', trait: 'Sensitive — feels things deeply' },
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

  await expect(page.locator('#status-title')).toHaveText(/waiting to be approved/i);
  await expect(page.locator('#family')).toContainText('Alef, 9');
  await expect(page.locator('#family')).toContainText('Gimel, 5');
  await expect(page.locator('#family')).toContainText('Dad and Ima');

  // Nothing may be startable before approval.
  await expect(page.locator('#start-card')).toBeHidden();

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

  await page.goto('/onboarding.html');
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
