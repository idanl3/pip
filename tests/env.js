import { existsSync, readFileSync } from 'node:fs';

/**
 * Loads .env into process.env for the test harness.
 *
 * Vite reads .env for the application itself, but the tests need it too - they
 * create invitations and clean up accounts through the management API, which
 * needs credentials the browser never sees. A dependency just for this would
 * be more weight than parsing a handful of KEY=value lines.
 *
 * Values already present in the environment win, so CI can override the file.
 */
export function loadEnvFile(path = '.env') {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, raw] = match;
    const value = raw.trim();
    if (value && !process.env[key]) process.env[key] = value;
  }
}
