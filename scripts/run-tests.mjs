import { spawnSync } from 'node:child_process';

/**
 * Runs the browser suite in one of its three modes.
 *
 *     node scripts/run-tests.mjs --built    build, serve dist/, test that
 *     node scripts/run-tests.mjs --live     test the deployed site
 *
 * This wrapper exists only because npm scripts run through cmd.exe on Windows,
 * where a `VAR=value command` prefix is not a thing. A dependency for that
 * would be more weight than ten lines.
 */

const mode = process.argv[2];
const passthrough = process.argv.slice(3);
const env = { ...process.env };

switch (mode) {
  case '--built':
    env.PIP_TEST_BUILT = '1';
    delete env.PIP_TEST_ORIGIN;
    break;

  case '--live':
    env.PIP_TEST_ORIGIN ??= 'https://pip.linnewiel.com';
    delete env.PIP_TEST_BUILT;
    break;

  default:
    console.error(`Unknown mode "${mode ?? ''}". Expected --built or --live.`);
    process.exit(2);
}

const result = spawnSync('npx', ['playwright', 'test', ...passthrough], {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status ?? 1);
