import { defineConfig } from '@playwright/test';
import { loadEnvFile } from './tests/env.js';

loadEnvFile();

// Point the suite at the deployed site instead of the dev server:
//
//     $env:PIP_TEST_ORIGIN = 'https://pip.linnewiel.com'; npm test
//
// Worth having, because a bug reached the owner that localhost could never
// have shown: the deployed bundle was two commits stale while the dev server
// was perfectly fine. Testing only localhost proves only localhost.
const origin = process.env.PIP_TEST_ORIGIN;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // These tests share one Supabase project and clean up after themselves, so
  // running them at once would have them deleting each other's accounts.
  fullyParallel: false,
  workers: 1,

  reporter: [['list']],

  use: {
    baseURL: origin ?? 'http://localhost:5173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // Playwright's own Chrome for Testing build could not be downloaded in
    // this environment, so the tests drive the Chrome already installed on the
    // machine. Close enough for smoke tests: it is the same major version, and
    // the alternative is no browser testing at all.
    channel: 'chrome',
  },

  // Only start a dev server when testing locally. Against the deployed site
  // there is nothing to start.
  webServer: origin
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
        // Stops Vite opening a browser window every time the tests run.
        env: { PIP_NO_OPEN: '1' },
      },
});
