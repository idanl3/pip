import { supabase } from './supabase.js';

/**
 * Accounts and sessions.
 *
 * A family reaches Pip through an invitation link the owner sends them. They
 * pick a password on arrival; no email is ever sent, so nothing depends on a
 * message being delivered.
 *
 * The invitation is not what creates the account — anyone can technically
 * register. It is what makes an account *useful*: the database refuses to
 * create a family profile for anyone who has not redeemed one, and an account
 * with no family profile can do nothing whatsoever. That rule lives in a
 * trigger rather than in this file, because code shipped to a browser is a
 * suggestion and a trigger is not.
 */

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** Sends the visitor to the sign-in page unless they are already signed in. */
export async function requireSession(returnTo = location.pathname) {
  const session = await getSession();
  if (!session) {
    location.replace(`/index.html?next=${encodeURIComponent(returnTo)}`);
    return null;
  }
  return session;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw friendlier(error);
  return data.session;
}

/**
 * Creates the account and returns its session.
 *
 * If the project still has "Confirm email" switched on, Supabase creates the
 * user but returns no session and tries to send a confirmation message — which
 * would reintroduce the exact email dependency the invitation link exists to
 * avoid. That shows up here as a clear error rather than a blank page.
 */
export async function createAccount(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });
  if (error) throw friendlier(error);

  if (!data.session) {
    throw new Error(
      'The account was created but could not be signed in, because this ' +
        'project still requires email confirmation. Pip is set up not to ' +
        'depend on email. Ask Idan to switch "Confirm email" off in the ' +
        'Supabase authentication settings.',
    );
  }
  return data.session;
}

/**
 * Claims an invitation code for the signed-in account.
 *
 * Returns true or false and nothing more. The database deliberately does not
 * reveal whether a code was wrong, already used, or expired, because telling
 * the difference would help someone guess at codes.
 */
export async function redeemInvite(code) {
  const { data, error } = await supabase.rpc('redeem_invite', {
    invite_code: String(code || '').trim().toUpperCase(),
  });
  if (error) throw friendlier(error);
  return data === true;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function isAdmin() {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

/**
 * Turns Supabase's wording into something a parent can act on.
 *
 * Deliberately vague about whether an email address exists: "no account with
 * that address" would let anyone test which of their friends uses Pip.
 */
function friendlier(error) {
  const message = String(error?.message || '');

  if (/invalid login credentials/i.test(message)) {
    return new Error('That email and password do not match. Please try again.');
  }
  if (/password should be at least/i.test(message)) {
    return new Error(message.replace(/^password/i, 'Password'));
  }
  if (/already registered|already been registered/i.test(message)) {
    return new Error('There is already an account with that email. Try signing in instead.');
  }
  if (/signups not allowed|signup is disabled/i.test(message)) {
    return new Error(
      'New accounts are currently switched off for this project, so this ' +
        'invitation cannot be completed. Ask Idan to re-enable sign-ups — the ' +
        'invitation itself is what controls access, not that setting.',
    );
  }
  if (/rate limit|too many requests/i.test(message)) {
    return new Error('Too many attempts just now. Please wait a minute and try again.');
  }
  if (/unable to validate email address|invalid format/i.test(message)) {
    return new Error('That does not look like an email address.');
  }

  return new Error(message || 'Something went wrong. Please try again.');
}
