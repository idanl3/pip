import { defineConfig } from '@playwright/test';
import { loadEnvFile } from './tests/env.js';

loadEnvFile();

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
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // Playwright's own Chrome for Testing build could not be downloaded in
    // this environment, so the tests drive the Chrome already installed on the
    // machine. Close enough for smoke tests: it is the same major version, and
    // the alternative is no browser testing at all.
    channel: 'chrome',
  },

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    // Stops Vite opening a browser window every time the tests run.
    env: { PIP_NO_OPEN: '1' },
  },
});
