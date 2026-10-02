/**
 * The parent's PIN, per device.
 *
 * What it is for: stopping a child opening Pip on the family tablet and
 * starting a session, or wandering into the parent area. It is a gate on the
 * screen in a house where the device is shared, not an attempt to resist
 * somebody who has the device and time.
 *
 * What it is not: the encryption key. Recaps are encrypted with a key held in
 * the browser and never derived from four digits, because four digits are
 * guessable in an afternoon and the key protects what children said.
 *
 * Only a salted hash is stored, and only locally. The server never sees the
 * PIN or its hash: a PIN that travelled to a server would be a password for
 * an account that already has one, and would need resetting through email,
 * which this project deliberately does not use.
 */

const STORAGE_KEY = 'pip.pin.v1';

// 210,000 iterations is OWASP's current PBKDF2-SHA512 recommendation. It costs
// a noticeable fraction of a second on a phone, which is the point: the search
// space of a six-digit PIN is a million, so the only defence worth having is
// making each guess slow.
const ITERATIONS = 210_000;

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function derive(pin, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt, iterations: ITERATIONS },
    material,
    256,
  );
}

export function isPinSet() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/** 4 to 6 digits, nothing else. */
export function validatePin(pin) {
  if (!/^\d{4,6}$/.test(pin)) return 'Please use 4 to 6 digits.';
  if (/^(\d)\1+$/.test(pin)) return 'Please avoid the same digit repeated.';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    return 'Please avoid a simple run of digits.';
  }
  return null;
}

export async function setPin(pin) {
  const problem = validatePin(pin);
  if (problem) throw new Error(problem);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      v: 1,
      salt: toBase64(salt),
      hash: toBase64(hash),
      iterations: ITERATIONS,
    }),
  );
}

export async function verifyPin(pin) {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return false;

  let record;
  try {
    record = JSON.parse(stored);
  } catch {
    return false;
  }

  const salt = fromBase64(record.salt);
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt,
      // Read from the record rather than the constant, so raising the cost
      // later does not lock everyone out of their own PIN.
      iterations: record.iterations ?? ITERATIONS,
    },
    material,
    256,
  );

  return constantTimeEqual(new Uint8Array(hash), fromBase64(record.hash));
}

/** Clears the PIN on this device. Used when a parent re-signs in. */
export function clearPin() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Compares without leaking where two values first differ.
 *
 * Timing is not a realistic threat for a PIN typed on a phone, but comparing
 * hashes with === is the kind of habit that is wrong somewhere that matters,
 * and this costs one loop.
 */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* --- slowing down guessing ----------------------------------------------- */

const ATTEMPTS_KEY = 'pip.pin.attempts.v1';
const LOCKOUT_AFTER = 5;
const LOCKOUT_SECONDS = 60;

/** Seconds still to wait, or 0. */
export function lockoutRemaining() {
  try {
    const { failures, until } = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? '{}');
    if (!failures || !until) return 0;
    const left = Math.ceil((until - Date.now()) / 1000);
    return left > 0 ? left : 0;
  } catch {
    return 0;
  }
}

export function recordFailure() {
  let failures = 0;
  try {
    failures = JSON.parse(localStorage.getItem(ATTEMPTS_KEY) ?? '{}').failures ?? 0;
  } catch {
    failures = 0;
  }
  failures += 1;

  // A child guessing gets bored long before a minute; this is mostly to stop
  // a determined one working through 1234, 1111, 0000 in a sitting.
  const until = failures >= LOCKOUT_AFTER ? Date.now() + LOCKOUT_SECONDS * 1000 : 0;
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify({ failures, until }));
  return { failures, locked: until > 0 };
}

export function clearFailures() {
  localStorage.removeItem(ATTEMPTS_KEY);
}
