import { defineConfig } from '@playwright/test';
import { loadEnvFile } from './tests/env.js';

loadEnvFile();

/**
 * Three ways to run the suite, and they catch different things.
 *
 *   npm test              the dev server. Fast, and the one to use while
 *                         writing code. Injects no content security policy,
 *                         so it cannot see policy violations at all.
 *
 *   npm run test:built    builds and serves dist/ locally. This is the one
 *                         that sees the real policy. A blocked inline style
 *                         looks perfectly fine on the dev server and then
 *                         silently does nothing in production, and that is
 *                         exactly how a layout bug reached the owner.
 *
 *   npm run test:live     the deployed site. The only way to catch a stale
 *                         deploy, which has also happened.
 *
 * Use the dev server while working, the built one before committing, and the
 * live one after deploying.
 */
const liveOrigin = process.env.PIP_TEST_ORIGIN;
const testBuilt = Boolean(process.env.PIP_TEST_BUILT);

const PREVIEW_PORT = 4173;

function server() {
  if (liveOrigin) return undefined; // nothing to start

  if (testBuilt) {
    return {
      command: `npm run build && npx vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    };
  }

  return {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
    // Stops Vite opening a browser window every time the tests run.
    env: { PIP_NO_OPEN: '1' },
  };
}

function baseURL() {
  if (liveOrigin) return liveOrigin;
  return testBuilt ? `http://localhost:${PREVIEW_PORT}` : 'http://localhost:5173';
}

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
    baseURL: baseURL(),
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // Playwright's own Chrome for Testing build could not be downloaded in
    // this environment, so the tests drive the Chrome already installed on the
    // machine. Same major version, and the alternative is no browser testing.
    channel: 'chrome',
  },

  webServer: server(),
});
