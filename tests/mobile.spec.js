import { test, expect } from '@playwright/test';
import { sql, createInvite, cleanupTestData, testEmail, TEST_PASSWORD } from './helpers.js';

/**
 * The site on a phone.
 *
 * Every other test in this suite runs at a desktop viewport, which is not
 * where this is used. The owner opened it on an Android phone, had to pinch to
 * read it, and could not comfortably hit the PIN keys. Measuring found three
 * separate causes: plain links 21px tall, chips 32px, and content sitting at
 * fixed rem widths in the middle of a screen it should have been filling.
 *
 * So this file asserts the two things that can be measured rather than
 * eyeballed, on every screen a family touches: nothing is wider than the
 * screen, and everything meant to be tapped is at least 44px tall.
 */

// A small modern Android phone, which is the floor worth supporting. Narrower
// than a Pixel, so what fits here fits on anything newer.
test.use({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

test.afterAll(cleanupTestData);

const PIN = '481902';

// 44px is the smallest target a thumb finds reliably. One pixel of slack, for
// fractional layout rounding at a device pixel ratio of 3.
const MIN_TAP = 43;

async function approvedFamily(page) {
  const email = testEmail();
  await page.goto(`/join.html?code=${await createInvite()}`);
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

  await sql(`
    update public.families set status = 'approved'
     where owner_id = (select id from auth.users where email = '${email}')
  `);
  return email;
}

/** Anything wider than the screen, and anything too small to tap. */
async function offenders(page, minTap) {
  return page.evaluate((floor) => {
    const doc = document.scrollingElement;
    const name = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` +
      `${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;

    const visible = (el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };

    const tooWide = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el) && el.getBoundingClientRect().width > doc.clientWidth + 1)
      .map((el) => `${name(el)} is ${Math.round(el.getBoundingClientRect().width)}px wide`);

    const tooSmall = [...document.querySelectorAll('button, a, input, textarea, .chip span')]
      // The chip's own checkbox is deliberately a 1px box behind its label,
      // and anything visually hidden is for screen readers only.
      .filter((el) => !el.closest('.visually-hidden') && !el.matches('.chip input'))
      .filter((el) => visible(el) && el.getBoundingClientRect().height < floor)
      .map((el) => `${name(el)} is ${Math.round(el.getBoundingClientRect().height)}px tall`);

    return {
      horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
      tooWide,
      tooSmall,
    };
  }, minTap);
}

async function check(page, label) {
  const found = await offenders(page, MIN_TAP);
  expect(found.tooWide, `${label}: wider than the screen`).toEqual([]);
  expect(found.tooSmall, `${label}: too small to tap`).toEqual([]);
  expect(found.horizontalScroll, `${label}: scrolls sideways`).toBe(false);
}

async function tapPin(page) {
  await page.waitForSelector('#stage-pin [data-pin-submit]');
  for (const digit of PIN) {
    await page.click(`#stage-pin button[data-key="${digit}"]`);
  }
}

test('every screen fits a phone and can be tapped', async ({ page }) => {
  await approvedFamily(page);

  // --- the launch screen --------------------------------------------------
  await page.goto('/home.html');
  await page.waitForSelector('#ready:not(.hidden)');
  await check(page, 'home.html');

  // --- the PIN, which is the screen that was hardest to hit ---------------
  await page.goto('/pip.html');
  await page.waitForSelector('#stage-pin [data-pin-submit]');
  await check(page, 'pip.html PIN');

  // On a short screen the keypad must still be reachable. It used to be
  // centred inside overflow:hidden, which cut it off at both ends with no way
  // to scroll to the rest.
  for (const height of [640, 600, 560]) {
    await page.setViewportSize({ width: 360, height });
    const reachable = await page.evaluate(() => {
      const doc = document.scrollingElement;
      const submit = document.querySelector('#stage-pin [data-pin-submit]');
      const panel = document.querySelector('#stage-pin .pip__panel');
      // Either everything fits, or the page scrolls far enough to reach it.
      return {
        topVisible: panel.getBoundingClientRect().top >= -1,
        bottomReachable:
          submit.getBoundingClientRect().bottom <= doc.clientHeight + 1 ||
          doc.scrollHeight > doc.clientHeight,
      };
    });
    expect(reachable.topVisible, `PIN at 360x${height}: top cut off`).toBe(true);
    expect(reachable.bottomReachable, `PIN at 360x${height}: cannot reach Continue`).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 740 });

  // --- the parents' portal ------------------------------------------------
  await page.goto('/parents.html');
  await tapPin(page);
  await page.click('#stage-pin [data-pin-submit]');
  await page.waitForSelector('#portal:not(.hidden)');
  await check(page, 'parents.html');

  // --- the family's answers, which is the longest form ---------------------
  await page.locator('#portal a[href="/onboarding.html"]').click();
  await page.waitForSelector('#form-area:not(.hidden)');
  await check(page, 'onboarding.html');

  // --- one child -----------------------------------------------------------
  await page.goto('/parents.html');
  await tapPin(page);
  await page.click('#stage-pin [data-pin-submit]');
  await page.waitForSelector('#portal:not(.hidden)');
  await page.locator('.kid-row', { hasText: 'Bet' }).getByRole('link', { name: 'Change' }).click();
  await page.waitForSelector('#form-area:not(.hidden)');
  await check(page, 'onboarding.html?child');
});
