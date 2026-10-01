import { defineConfig, loadEnv } from 'vite';
import { readdirSync } from 'node:fs';

/**
 * Every page in the site. Collected from the .html files at the repository
 * root so that adding a page needs no build configuration.
 */
function pageInputs() {
  const pages = readdirSync('.').filter((f) => f.endsWith('.html'));
  return Object.fromEntries(pages.map((f) => [f.replace(/\.html$/, ''), `./${f}`]));
}

export default defineConfig(({ mode }) => {
  // Read .env directly rather than through import.meta.env, because the policy
  // below is assembled at config time, before any of that exists.
  const env = loadEnv(mode, process.cwd(), '');

  const supabase = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : '';
  const supabaseSocket = supabase.replace(/^https:/, 'wss:');

  /**
   * Content Security Policy for the deployed site.
   *
   * GitHub Pages cannot send HTTP headers, so the policy is injected as a meta
   * tag at build time. It is deliberately not written into the HTML files,
   * because the dev server needs inline scripts and a websocket for hot
   * reload, and a policy loose enough for that is not worth having.
   *
   * `default-src 'none'` means every category has to be granted deliberately.
   * Phase 4 adds the ElevenLabs origins to connect-src and media-src, and
   * nothing else should ever be added without a reason written down here.
   */
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${supabaseSocket}`.replace(/\s+/g, ' ').trim(),
    "manifest-src 'self'",
    "base-uri 'none'",
    // No form is ever submitted to a server: everything goes through fetch.
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  return {
    appType: 'mpa',
    server: { port: 5173, open: true },

    plugins: [
      {
        name: 'pip-csp',
        apply: 'build',
        transformIndexHtml(html) {
          const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
          // Immediately after the charset declaration: that has to stay first,
          // and the policy has to precede anything that loads a resource.
          return html.replace(
            /(<meta\s+charset=["']?utf-8["']?\s*\/?>)/i,
            `$1\n    ${meta}`,
          );
        },
      },
    ],

    build: {
      target: 'es2022',
      rollupOptions: { input: pageInputs() },
      // The module preload polyfill is an inline script, which the policy
      // above would block. Our browser targets do not need it.
      modulePreload: { polyfill: false },
    },
  };
});
