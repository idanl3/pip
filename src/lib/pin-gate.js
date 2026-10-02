import {
  isPinSet,
  setPin,
  verifyPin,
  validatePin,
  recordFailure,
  clearFailures,
  lockoutRemaining,
  pinLength,
} from './pin.js';

/**
 * One unlock, handed to the next page in this tab.
 *
 * The parent area is several pages - the portal, the family's answers, one
 * child's answers - and asking for the same PIN on each of them within a few
 * seconds is how a parent ends up choosing 1234. So a page that has just been
 * unlocked may pass one unlock to the page it is sending the parent to.
 *
 * It is not a remembered window. The token is per-tab, is consumed by the
 * first page that reads it, and survives exactly one navigation: a reload
 * asks again, a second link asks again, another tab never had it. And the
 * kids' screen deliberately does not accept it - see acceptHandoff below.
 */

const HANDOFF_KEY = 'pip.pin.handoff.v1';

export function grantHandoff() {
  try {
    sessionStorage.setItem(HANDOFF_KEY, '1');
  } catch {
    // Private browsing can refuse this. Asking for the PIN again is the
    // correct way to fail.
  }
}

function takeHandoff() {
  try {
    const held = sessionStorage.getItem(HANDOFF_KEY) !== null;
    sessionStorage.removeItem(HANDOFF_KEY);
    return held;
  } catch {
    return false;
  }
}

/**
 * The PIN keypad, as a gate in front of something.
 *
 * Two things sit behind it, and the brief asks for both: starting a session,
 * and the parent area. The parent area matters more than it first looks -
 * that is where a child's profile lives, and "cries and finds it hard to stop"
 * is not something a child should read about themselves over a parent's
 * shoulder.
 *
 * On-screen rather than a text field, because this lives on a family tablet
 * where a text field summons a keyboard over half the screen. Dots rather than
 * digits, because the children are usually standing right there.
 *
 * There is no Continue button when the PIN is being entered. The stored record
 * knows how many digits it has, so the last tap is the one that opens the
 * door - which removes a press from every session, and from every trip into
 * the parent area. Choosing a PIN still has a button, because nothing knows
 * how long that one is meant to be until it is confirmed.
 *
 * Resolves when the PIN is accepted. Never rejects: a parent who cannot
 * remember it stays on this screen, which is the correct outcome.
 */
export function requirePin(mount, { heading, explainer, acceptHandoff = false } = {}) {
  const creating = !isPinSet();

  // Off by default, and off on the kids' screen for two separate reasons.
  // A session must be behind a PIN every single time: the tablet is put down
  // in a room with the children in it the moment one ends. And the tap that
  // accepts the PIN is the user gesture the browser grants the microphone
  // under, so resolving without one would start a session with no audio.
  if (acceptHandoff && !creating && takeHandoff()) {
    mount.classList.add('hidden');
    return Promise.resolve();
  }

  mount.replaceChildren();
  mount.classList.remove('hidden');

  const panel = document.createElement('div');
  panel.className = 'pip__panel pip__panel--centred';

  const title = document.createElement('h1');
  title.className = 'pip__heading';
  // Stable hooks for the tests. The gate is built in code and appears on more
  // than one page, so there are no page-level ids to aim at.
  title.dataset.pinHeading = '';
  title.textContent = creating ? 'Choose a parent PIN' : (heading ?? 'Parent PIN');

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = creating
    ? "Four to six digits, just for this device. It keeps this out of your children's hands."
    : (explainer ?? 'So this can only be opened by you.');

  // Says "Checking..." the instant the last digit lands, because verifying is
  // deliberately slow and an unresponsive keypad reads as a broken one.
  const working = document.createElement('p');
  working.className = 'pip__working';
  working.dataset.pinWorking = '';

  const dots = document.createElement('div');
  dots.className = 'pip__dots';
  dots.setAttribute('aria-hidden', 'true');

  const error = document.createElement('p');
  error.className = 'field__error';
  error.dataset.pinError = '';
  error.setAttribute('role', 'alert');

  const keypad = document.createElement('div');
  keypad.className = 'pip__keypad';

  const count = document.createElement('p');
  count.className = 'visually-hidden';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');

  const expected = creating ? null : pinLength();
  // A device that set its PIN before the length was recorded has to be tried
  // at every allowed length instead. Rare, and it costs only the work.
  const autoLengths = expected ? [expected] : [4, 5, 6];

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn--block';
  submit.dataset.pinSubmit = '';
  submit.textContent = creating ? 'Set PIN' : 'Continue';
  // Kept in the markup for the tests and for a keyboard, but a parent tapping
  // the keypad never needs to reach it.
  if (!creating) submit.classList.add('hidden');

  const forgot = document.createElement('p');
  forgot.className = 'muted pip__aside';
  forgot.textContent = creating
    ? 'This is not the key to anything your children said. It only gates this screen.'
    : 'Forgotten it? Sign out and back in to set a new one.';

  panel.append(title, note, dots, error, working, keypad, count, submit, forgot);
  mount.append(panel);

  let entered = '';

  // Assigned when the promise below is constructed, which happens before any
  // tap can reach press(). It lives out here because press() is defined
  // outside the promise and has to be able to call it.
  let attempt = async () => {};

  function render() {
    dots.replaceChildren(
      ...Array.from({ length: entered.length }, () => {
        const dot = document.createElement('span');
        dot.className = 'pip__dot';
        return dot;
      }),
    );
    // Screen readers get a count, never the digits.
    count.textContent = entered.length ? `${entered.length} digits entered` : 'empty';
  }

  function press(key) {
    error.textContent = '';
    if (key === 'back') entered = entered.slice(0, -1);
    else if (key === 'clear') entered = '';
    else if (/^\d$/.test(key) && entered.length < 6) entered += key;
    render();

    // The last digit is the button. Only at a length the stored PIN could
    // actually be, so a six-digit PIN is not checked three times on the way.
    if (!creating && autoLengths.includes(entered.length)) {
      attempt({ silent: entered.length < 6 && autoLengths.length > 1 });
    }
  }

  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.key = key;
    if (key === 'clear') {
      button.className = 'pip__key--quiet';
      button.textContent = 'Clear';
    } else if (key === 'back') {
      button.className = 'pip__key--quiet';
      button.textContent = '⌫';
      button.setAttribute('aria-label', 'Delete');
    } else {
      button.textContent = key;
    }
    keypad.append(button);
  }

  keypad.addEventListener('click', (event) => {
    const key = event.target.closest('button')?.dataset.key;
    if (key) press(key);
  });

  render();

  return new Promise((resolve) => {
    let busy = false;

    /**
     * Checks what has been typed.
     *
     * `silent` is for the one awkward case: a device whose stored PIN predates
     * the length being recorded, where four and five digits have to be tried
     * on the way to six. A wrong guess at four digits is not a wrong PIN, it
     * is an unfinished one, so it must not clear the entry, show an error, or
     * count towards the lockout.
     */
    attempt = async function check({ silent = false } = {}) {
      if (busy) return;
      error.textContent = '';

      const waiting = lockoutRemaining();
      if (waiting > 0) {
        error.textContent = `Too many tries. Wait ${waiting} seconds.`;
        return;
      }

      if (creating) {
        const problem = validatePin(entered);
        if (problem) {
          error.textContent = problem;
          return;
        }
        await setPin(entered);
        clearFailures();
        done();
        return;
      }

      busy = true;
      submit.disabled = true;
      // Verifying is deliberately slow - two hundred thousand rounds of it -
      // and on a phone that is long enough for a keypad with no button to look
      // broken. Say what is happening before starting.
      working.textContent = 'Checking\u2026';

      const candidate = entered;
      const ok = await verifyPin(candidate);

      busy = false;
      submit.disabled = false;
      working.textContent = '';

      // They kept typing while that ran, so the answer is about a PIN that is
      // no longer on screen.
      if (candidate !== entered) return;

      if (!ok) {
        if (silent) return;
        const { locked } = recordFailure();
        error.textContent = locked ? 'Too many tries. Wait a minute.' : 'That is not the PIN.';
        entered = '';
        render();
        return;
      }

      clearFailures();
      working.textContent = 'Opening\u2026';
      done();
    };

    function done() {
      document.removeEventListener('keydown', onKey);
      mount.classList.add('hidden');
      // Resolve inside the click that accepted the PIN, so the browser still
      // counts it as a user gesture. The microphone is only granted during
      // one, and this tap is what the session starts from.
      resolve();
    }

    function onKey(event) {
      if (mount.classList.contains('hidden')) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('back');
      else if (event.key === 'Enter') attempt();
    }

    // Wrapped, so a click event is not read as an options object.
    submit.addEventListener('click', () => attempt());
    // A physical keyboard still works, for a laptop.
    document.addEventListener('keydown', onKey);
  });
}
