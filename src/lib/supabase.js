import { createClient } from '@supabase/supabase-js';

/**
 * The one Supabase client the site uses.
 *
 * Both values below are public on purpose. The publishable key is designed to
 * ship inside a browser bundle; row-level security is what protects the data,
 * not the secrecy of this string. Nothing secret may ever be imported here —
 * anything in `src/` ends up readable in the built site.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Supabase is not configured. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.',
  );
}

export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // There is no email link to come back from, so there is no fragment in the
    // URL to parse. Leaving this on would have the client inspect every page
    // load for tokens it will never find.
    detectSessionInUrl: false,
  },
});
