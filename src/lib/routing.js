import { isAdmin } from './auth.js';
import { loadFamily } from './data.js';

/**
 * Decides where someone belongs after signing in.
 *
 * Kept in one place because three pages need the same answer, and because the
 * question "has this family filled anything in yet" should have exactly one
 * implementation.
 */
export async function routeAfterSignIn() {
  // ?next= survives being sent to the sign-in page mid-journey, but only
  // same-site paths are honoured. Taking an arbitrary value here would turn
  // the sign-in page into an open redirect.
  const next = new URLSearchParams(location.search).get('next');
  if (next && /^\/[A-Za-z0-9._/-]*$/.test(next) && !next.startsWith('//')) {
    location.replace(next);
    return;
  }

  if (await isAdmin()) {
    location.replace('/admin.html');
    return;
  }

  const family = await loadFamily();
  location.replace(family ? '/home.html' : '/onboarding.html');
}
