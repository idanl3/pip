/**
 * Shared bits for the edge functions: who may call them, and how to answer.
 */

/**
 * Origins allowed to call these functions.
 *
 * An explicit list rather than "*". These endpoints spend the owner's
 * ElevenLabs minutes, so any page that can call them can cost money, and a
 * wildcard would let any site on the internet do it with a logged-in parent's
 * browser.
 */
const ALLOWED_ORIGINS = new Set([
  'https://pip.linnewiel.com',
  'http://localhost:5173', // vite dev
  'http://localhost:4173', // vite preview, used by the built-output tests
]);

/**
 * Every header the browser actually sends.
 *
 * `apikey` is the one that is easy to forget and expensive to debug. Supabase
 * requires it on every request, and a preflight that does not list it makes
 * the browser refuse the real request — reporting only "Failed to fetch",
 * which says nothing about headers, CORS, or anything else useful. The
 * preflight itself answers 204 quite happily, so it looks fine from a script.
 *
 * x-client-info and x-supabase-api-version are added by supabase-js rather
 * than by our own fetch calls, and cost nothing to allow.
 */
const ALLOWED_HEADERS = 'apikey, authorization, content-type, x-client-info, x-supabase-api-version';

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://pip.linnewiel.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

/**
 * A refusal a parent can read.
 *
 * `message` is shown to them, so it has to be plain and kind: these appear
 * when a family is waiting to be approved or has run out of minutes, which is
 * a disappointment, not an error. `code` is for the page to branch on.
 */
export function refuse(
  code: string,
  message: string,
  origin: string | null,
  status = 403,
  detail?: string,
): Response {
  // `detail` carries the underlying error and is only ever returned when the
  // PIP_DEBUG function secret is set to 1. Edge function logs are awkward to
  // read from a script, and an opaque "something went wrong" is useless when
  // the cause is a rejected API key. Set the secret, reproduce, unset it.
  const debugging = Deno.env.get('PIP_DEBUG') === '1';
  return json(
    { error: code, message, ...(debugging && detail ? { detail } : {}) },
    status,
    origin,
  );
}

/** Never log a token, a transcript, or anything a child said. */
export function logLine(event: string, fields: Record<string, string | number | boolean> = {}) {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
  console.log([event, ...parts].join(' '));
}
