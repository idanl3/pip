import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Builds the two Supabase clients an edge function needs.
 *
 * This is not boilerplate; it exists because the obvious code is wrong on this
 * project.
 *
 * Every example reaches for SUPABASE_SERVICE_ROLE_KEY, and the platform does
 * inject it. But this project was created under the new publishable/secret key
 * system with legacy keys disabled, so the gateway answers 401 to that key —
 * an empty 401, with no message explaining why. The function then reports
 * "something went wrong" and every check downstream appears broken.
 *
 * The usable keys arrive instead as JSON dictionaries:
 *
 *   SUPABASE_SECRET_KEYS      {"default": "sb_secret_..."}
 *   SUPABASE_PUBLISHABLE_KEYS {"default": "sb_publishable_..."}
 *
 * Both shapes are handled, newest first, with the legacy names as a fallback
 * so this keeps working on a project where legacy keys are still enabled.
 */

function fromDictionary(variable: string): string | undefined {
  const raw = Deno.env.get(variable);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) return parsed.find((v) => typeof v === 'string');
    if (parsed && typeof parsed === 'object') {
      // "default" is what Supabase names the key it creates with a project.
      const preferred = parsed.default;
      if (typeof preferred === 'string') return preferred;
      return Object.values(parsed).find((v) => typeof v === 'string') as string | undefined;
    }
  } catch {
    // Not JSON. Some projects set the bare key under this name.
    return raw;
  }
  return undefined;
}

function secretKey(): string {
  const key = fromDictionary('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    throw new Error(
      'No secret key available. Expected SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return key;
}

function publishableKey(): string {
  const key = fromDictionary('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY');
  if (!key) {
    throw new Error(
      'No publishable key available. Expected SUPABASE_PUBLISHABLE_KEYS or SUPABASE_ANON_KEY.',
    );
  }
  return key;
}

/**
 * A client that is the caller.
 *
 * Used only to establish who they are. It can read nothing they could not read
 * themselves, because row-level security still applies to it.
 */
export function clientAsCaller(authHeader: string): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A client that bypasses row-level security.
 *
 * Everything it touches must be scoped by hand to the family the caller
 * actually owns. There is no safety net behind this one.
 */
export function clientAsService(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
