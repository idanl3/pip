import { defineConfig } from 'vite';

/**
 * Content Security Policy for the deployed site.
 *
 * GitHub Pages cannot send custom HTTP headers, so the policy is injected as a
 * meta tag at build time. It is deliberately NOT written into index.html,
 * because the dev server needs inline scripts and a websocket for hot reload.
 *
 * Phase 1 allows nothing but our own files. Later phases add exactly two
 * outside origins and nothing else:
 *   connect-src  https://<project>.supabase.co wss://<project>.supabase.co
 *                https://api.elevenlabs.io wss://api.elevenlabs.io
 *   media-src    the ElevenLabs audio stream
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Adds the CSP meta tag to every page, on build only. */
const cspPlugin = {
  name: 'pip-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;
    // Goes immediately after the charset declaration: that one has to stay
    // first, and the policy has to precede anything that loads a resource.
    return html.replace(
      /(<meta\s+charset=["']?utf-8["']?\s*\/?>)/i,
      `$1\n    ${meta}`,
    );
  },
};

export default defineConfig({
  appType: 'mpa',
  plugins: [cspPlugin],
  server: { port: 5173, open: true },
  build: {
    target: 'es2022',
    // The module preload polyfill is an inline script, which the policy above
    // would block. Our browser targets don't need it.
    modulePreload: { polyfill: false },
  },
});
