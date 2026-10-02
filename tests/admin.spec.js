import { test, expect } from '@playwright/test';
import {
  sql,
  createInvite,
  cleanupTestData,
  testEmail,
  watchForErrors,
  promoteToAdmin,
  familyOf,
  TEST_PASSWORD,
} from './helpers.js';

/**
 * The owner's side: reviewing a family, approving it, setting its minutes,
 * sending it back with a note, and inviting someone.
 *
 * Both accounts are created through the real journey rather than seeded, so
 * the test exercises the same path a family takes. The admin is promoted
 * afterwards with database credentials, because that is the only way in -
 * public.admins has no grants and no policies at all.
 *
 * Note the marker in the parent names. The admin screen shows every family,
 * including the owner's real one, and a test must never approve or pause that.
 * Every action below is scoped to the card containing the marker.
 */

const MARKER = 'E2E-REVIEW-MARKER';

test.afterAll(cleanupTestData);

/**
 * Gets past the PIN gate that now guards the profile form.
 *
 * A fresh browser context has no PIN, so the gate offers to set one. Which is
 * the point: the form describes each child's temperament, and a child should
 * not be able to read that about themselves by picking up the tablet.
 */
async function passPinGate(page, pin = '481902') {
  await page.waitForSelector('#stage-pin [data-pin-submit]');
  for (const digit of pin) {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
  await page.click('#stage-pin [data-pin-submit]');
  await page.waitForSelector('#form-area:not(.hidden)');
}

async function join(page, code, email) {
  await page.goto(`/join.html?code=${code}`);
  await page.fill('#email', email);
  await page.fill('#password', TEST_PASSWORD);
  await page.click('#submit');
  await page.waitForURL('**/onboarding.html');
}

test('the owner reviews, approves, limits and sends back a family', async ({ browser }) => {
  // --- a family submits a profile ----------------------------------------
  const familyEmail = testEmail();
  const familyContext = await browser.newContext();
  const familyPage = await familyContext.newPage();
  const familyErrors = watchForErrors(familyPage);

  await join(familyPage, await createInvite(), familyEmail);

  await familyPage.fill('#parent-other', MARKER);
  const kids = familyPage.locator('#children > .child');
  await kids.nth(1).locator('.js-remove').click();
  await kids.nth(0).locator('.js-name').fill('Zayin');
  await kids.nth(0).locator('.js-age').fill('6');
  await familyPage.click('#submit');
  await familyPage.waitForURL('**/home.html');

  await expect(familyPage.locator('#status-title')).toHaveText(/waiting to be approved/i);
  await expect(familyPage.locator('#start-card')).toBeHidden();

  // --- the owner signs in ------------------------------------------------
  const adminEmail = testEmail();
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const adminErrors = watchForErrors(adminPage);

  await join(adminPage, await createInvite(), adminEmail);

  // Before promotion, the admin screen must turn them away.
  await adminPage.goto('/admin.html');
  await adminPage.waitForURL('**/onboarding.html');

  await promoteToAdmin(adminEmail);
  await adminPage.goto('/admin.html');

  const card = () => adminPage.locator('.card', { hasText: MARKER });
  await expect(card()).toBeVisible();
  await expect(card()).toContainText('waiting for you');
  await expect(card()).toContainText('Zayin, 6');

  // --- approve ------------------------------------------------------------
  await card().getByRole('button', { name: 'Approve' }).click();
  await expect(card()).toContainText('approved');
  expect((await familyOf(familyEmail)).status).toBe('approved');

  // The family's own screen should now offer a session.
  await familyPage.reload();
  await expect(familyPage.locator('#start-card')).toBeVisible();

  // --- minute limit -------------------------------------------------------
  await card().locator('input[type="number"]').fill('45');
  // exact, because the practice-notes section on the same card has a
  // 'Save notes' button and getByRole matches accessible names by substring.
  await card().getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await familyOf(familyEmail)).monthly_minute_limit).toBe(45);

  // --- send back with a note ---------------------------------------------
  // The screen uses prompt() for this, deliberately plain for now.
  adminPage.once('dialog', (dialog) => dialog.accept('Could you say a bit more about Zayin?'));
  await card().getByRole('button', { name: 'Send back' }).click();

  await expect(card()).toContainText('sent back');
  const sentBack = await familyOf(familyEmail);
  expect(sentBack.status).toBe('needs_changes');
  expect(sentBack.review_note).toContain('a bit more about Zayin');

  // The parent should see that note, in their own words-facing wording. The
  // form is behind the PIN now, so get through that first.
  await familyPage.goto('/onboarding.html');
  await passPinGate(familyPage);
  await expect(familyPage.locator('#review-note')).toContainText('a bit more about Zayin');

  // And editing should send it back to pending without the owner doing
  // anything, because any parent edit means a fresh look.
  await familyPage.locator('#children > .child').nth(0).locator('.js-personality-other')
    .fill('Loves building things');
  await familyPage.click('#submit');
  await familyPage.waitForURL('**/home.html');
  expect((await familyOf(familyEmail)).status).toBe('pending');

  // --- a plain parent cannot reach the admin screen ----------------------
  await familyPage.goto('/admin.html');
  await familyPage.waitForURL('**/home.html');

  expect(familyErrors, 'the family saw console errors').toEqual([]);
  expect(adminErrors, 'the admin saw console errors').toEqual([]);
});

test('an owner who is also a family lands on their own home, not the admin screen', async ({
  browser,
}) => {
  // The bug this guards against: being an admin used to send you to the admin
  // area on every sign-in, so the owner - who runs the pilot and is also a
  // family in it - could never reach their own home page or start a session
  // with their own children.
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = watchForErrors(page);

  const email = testEmail();
  await join(page, await createInvite(), email);
  await page.fill('#parent-other', 'Mum');
  const kids = page.locator('#children > .child');
  await kids.nth(1).locator('.js-remove').click();
  await kids.nth(0).locator('.js-name').fill('Vav');
  await kids.nth(0).locator('.js-age').fill('8');
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  await sql(`
    update public.families set status = 'approved'
     where owner_id = (select id from auth.users where email = '${email}')
  `);
  await promoteToAdmin(email);

  // Arriving at the front door while already signed in.
  await page.goto('/index.html');
  await page.waitForURL('**/home.html');

  // A session they can start. The home screen deliberately no longer prints
  // the children's profiles: it is opened with them in the room.
  await expect(page.locator('#start-card')).toBeVisible();
  await expect(page.locator('#minutes')).toContainText(/minutes left this month/i);
  await expect(page.locator('body')).not.toContainText('Vav');

  // The admin area is reachable, but as a link rather than a destination.
  const adminLink = page.locator('#admin-link');
  await expect(adminLink).toBeVisible();
  await adminLink.click();
  await page.waitForURL('**/admin.html');

  // And there is a way back out of it.
  await page.getByRole('link', { name: 'Your own family' }).click();
  await page.waitForURL('**/home.html');

  expect(errors).toEqual([]);
});

test('a parent who is not an admin never sees the admin link', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const email = testEmail();

  await join(page, await createInvite(), email);
  await page.fill('#parent-other', 'Mum');
  const kids = page.locator('#children > .child');
  await kids.nth(1).locator('.js-remove').click();
  await kids.nth(0).locator('.js-name').fill('Zayin');
  await kids.nth(0).locator('.js-age').fill('5');
  await page.click('#submit');
  await page.waitForURL('**/home.html');

  await expect(page.locator('#admin-link')).toBeHidden();
});

test('the owner can create an invitation and copy its link', async ({ browser }) => {
  const adminEmail = testEmail();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = watchForErrors(page);

  await join(page, await createInvite(), adminEmail);
  await promoteToAdmin(adminEmail);
  await page.goto('/admin.html');

  const label = `E2E-INVITE-${Date.now()}`;
  await page.fill('#invite-label', label);
  await page.click('#make-invite');

  const invite = page.locator('#invites .card', { hasText: label });
  await expect(invite).toBeVisible();

  // The link is what the owner actually sends, so it has to be right.
  const link = await invite.locator('input[readonly]').inputValue();
  expect(link).toMatch(/\/join\.html\?code=[A-Z2-9]{12}$/);

  // And it has to work. Following it should reach the join page with the code
  // already filled and hidden.
  const code = new URL(link).searchParams.get('code');
  const familyPage = await (await browser.newContext()).newPage();
  await familyPage.goto(`/join.html?code=${code}`);
  await expect(familyPage.locator('#code')).toHaveValue(code);
  await expect(familyPage.locator('#code-field')).toBeHidden();

  expect(errors).toEqual([]);
});
