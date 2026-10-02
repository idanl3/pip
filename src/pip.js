import { requireSession } from './lib/auth.js';
import { loadFamily, loadChildren } from './lib/data.js';
import { PipBlob } from './lib/blob.js';
import { PipSession } from './lib/session.js';
import {
  isPinSet,
  setPin,
  verifyPin,
  validatePin,
  recordFailure,
  clearFailures,
  lockoutRemaining,
} from './lib/pin.js';

/**
 * The kids' screen, and the parent's way into it.
 *
 * Three stages on one page: the PIN, choosing who is involved, and the blob —
 * then a visibly finished state. One page because the browser grants the
 * microphone only on a user gesture, and a gesture does not survive a
 * navigation.
 *
 * The PIN guards *starting*, and nothing else. Finishing is immediate and
 * unguarded: a conversation nobody wants should stop the moment somebody says
 * so, and asking for a PIN first meant Pip carried on talking while it was
 * typed. A child who ends a session they did not want to have has not broken
 * anything; they cannot start another one without the PIN.
 */

const OTHER = 'other';

const stages = {
  pin: document.querySelector('#stage-pin'),
  setup: document.querySelector('#stage-setup'),
  live: document.querySelector('#stage-live'),
  done: document.querySelector('#stage-done'),
};

const notice = document.querySelector('#notice');
const whoHost = document.querySelector('#who');
const minutesLine = document.querySelector('#minutes');
const startButton = document.querySelector('#start');
const statusLine = document.querySelector('#status');
const endButton = document.querySelector('#end');
const doneDetail = document.querySelector('#done-detail');
const alertBox = document.querySelector('#alert');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let children = [];
let blob = null;
let session = null;
const transcript = [];

function show(name) {
  for (const [key, element] of Object.entries(stages)) {
    element.classList.toggle('hidden', key !== name);
  }
}

function fail(message) {
  notice.textContent = message;
}

/* --- start up ------------------------------------------------------------ */

(async function begin() {
  const authed = await requireSession();
  if (!authed) return;

  const family = await loadFamily();
  if (!family) {
    location.replace('/onboarding.html');
    return;
  }
  if (family.status !== 'approved') {
    location.replace('/home.html');
    return;
  }

  children = await loadChildren(family.id);
  renderWho();
  minutesLine.textContent = `${family.monthly_minute_limit} minutes a month for your family.`;

  // A PIN is per device, so a parent on a new phone sets one on arrival rather
  // than being locked out of their own account.
  if (isPinSet()) preparePinEntry();
  else preparePinSetup();
  show('pin');
})().catch((error) => fail(error.message));

function renderWho() {
  const chip = (value, text) => {
    const label = document.createElement('label');
    label.className = 'chip';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.name = 'who';

    const span = document.createElement('span');
    span.textContent = text;

    label.append(input, span);
    return label;
  };

  whoHost.replaceChildren(
    ...children.map((child) => chip(child.id, `${child.first_name} (${child.age})`)),
    // A cousin, a friend, a sibling nobody added. Pip is told it does not know
    // this child and asks their name and age itself, rather than being handed
    // a profile that does not describe them.
    chip(OTHER, 'Someone else'),
  );
}

/* --- the PIN ------------------------------------------------------------- */

const dotsHost = document.querySelector('#pin-dots');
const pinError = document.querySelector('#pin-error');
const pinHeading = document.querySelector('#pin-heading');
const pinExplainer = document.querySelector('#pin-explainer');
const pinSubmit = document.querySelector('#pin-submit');
const pinForgot = document.querySelector('#pin-forgot');
const pinCount = document.querySelector('#pin-count');
const keypad = document.querySelector('#keypad');

let pinMode = 'enter';
let entered = '';

function preparePinSetup() {
  pinMode = 'create';
  pinHeading.textContent = 'Choose a parent PIN';
  pinExplainer.textContent =
    'Four to six digits, just for this device. It stops a session being started without you.';
  pinSubmit.textContent = 'Set PIN';
  pinForgot.textContent =
    'This is not the key to anything your children said. It only gates this screen.';
}

function preparePinEntry() {
  pinMode = 'enter';
  pinHeading.textContent = 'Parent PIN';
  pinExplainer.textContent = 'So a session can only be started by you.';
  pinSubmit.textContent = 'Continue';
  pinForgot.textContent = 'Forgotten it? Sign out and back in to set a new one.';
}

function renderDots() {
  dotsHost.replaceChildren(
    ...Array.from({ length: entered.length }, () => {
      const dot = document.createElement('span');
      dot.className = 'pip__dot';
      return dot;
    }),
  );
  // Screen readers get a count, never the digits.
  pinCount.textContent = entered.length ? `${entered.length} digits entered` : 'empty';
}

function press(key) {
  pinError.textContent = '';
  if (key === 'back') entered = entered.slice(0, -1);
  else if (key === 'clear') entered = '';
  else if (/^\d$/.test(key) && entered.length < 6) entered += key;
  renderDots();
}

keypad.addEventListener('click', (event) => {
  const key = event.target.closest('button')?.dataset.key;
  if (key) press(key);
});

// A physical keyboard still works, for a laptop.
document.addEventListener('keydown', (event) => {
  if (stages.pin.classList.contains('hidden')) return;
  if (/^\d$/.test(event.key)) press(event.key);
  else if (event.key === 'Backspace') press('back');
  else if (event.key === 'Enter') submitPin();
});

pinSubmit.addEventListener('click', submitPin);

async function submitPin() {
  pinError.textContent = '';

  const waiting = lockoutRemaining();
  if (waiting > 0) {
    pinError.textContent = `Too many tries. Wait ${waiting} seconds.`;
    return;
  }

  if (pinMode === 'create') {
    const problem = validatePin(entered);
    if (problem) {
      pinError.textContent = problem;
      return;
    }
    await setPin(entered);
    clearFailures();
    entered = '';
    renderDots();
    show('setup');
    return;
  }

  pinSubmit.disabled = true;
  const ok = await verifyPin(entered);
  pinSubmit.disabled = false;

  if (!ok) {
    const { locked } = recordFailure();
    pinError.textContent = locked ? 'Too many tries. Wait a minute.' : 'That is not the PIN.';
    entered = '';
    renderDots();
    return;
  }

  clearFailures();
  entered = '';
  renderDots();
  show('setup');
}

/* --- the status line ----------------------------------------------------- */

/**
 * Keeps the words under the blob still.
 *
 * The agent's mode flips between listening and speaking far faster than a
 * person can read, so following it directly made the line flicker between the
 * two and look broken. Only a state that has held for a moment is worth
 * printing; the blob itself reacts immediately, which is where the real-time
 * signal belongs.
 *
 * "Thinking" never reaches the text at all. It is a transient the children do
 * not need and the parent cannot act on.
 */
const STATUS_SETTLE_MS = 700;
let settleTimer = null;
let shownState = null;

function setStatus(state) {
  if (state === 'ended') {
    clearTimeout(settleTimer);
    statusLine.textContent = 'Pip has stopped listening';
    shownState = state;
    return;
  }
  if (state !== 'listening' && state !== 'speaking') return;
  if (state === shownState) return;

  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    shownState = state;
    statusLine.textContent = state === 'speaking' ? 'Pip is talking' : 'Pip is listening';
  }, STATUS_SETTLE_MS);
}

/* --- starting ------------------------------------------------------------ */

startButton.addEventListener('click', async () => {
  notice.textContent = '';
  const chosen = [...whoHost.querySelectorAll('input:checked')].map((i) => i.value);

  if (chosen.length === 0) {
    fail('Please tap who needs help.');
    return;
  }

  const includeOther = chosen.includes(OTHER);
  const childIds = chosen.filter((value) => value !== OTHER);

  startButton.disabled = true;
  startButton.textContent = 'Asking Pip…';

  // The blob runs before the conversation connects, so the children see
  // something alive during the handshake rather than a blank screen.
  show('live');
  statusLine.textContent = 'Getting Pip…';
  shownState = null;
  blob = new PipBlob(document.querySelector('#blob'), { reducedMotion });
  blob.setState('idle');
  blob.start();

  session = new PipSession({
    onState: (state) => {
      blob?.setState(state === 'waiting' ? 'idle' : state);
      setStatus(state);
    },
    onLevels: (levels) => blob?.setLevels(levels),
    onTranscript: (turn) => {
      // Held in memory for phase 6's recap, which the browser will write and
      // encrypt itself. Never uploaded from here, never logged.
      transcript.push(turn);
    },
    onSafetyAlert: () => {
      alertBox.classList.remove('hidden');
      document.querySelector('#alert-ok').focus();
    },
    onEnded: (reason) => {
      blob?.setState('ended');
      doneDetail.textContent = describeEnding(reason);
      // Let the blob visibly settle before the screen changes. Cutting
      // straight to a panel loses the one cue a small child can read.
      setTimeout(() => {
        show('done');
        blob?.stop();
      }, 1800);
    },
    onError: (message) => fail(message),
  });

  try {
    await session.start({ childIds, includeOther });
  } catch (error) {
    blob?.stop();
    show('setup');
    startButton.disabled = false;
    startButton.textContent = 'Start';
    fail(friendlyStartError(error));
  }
});

/**
 * A refusal a parent can act on.
 *
 * The server already words these kindly; this adds the one thing it cannot
 * know, which is what the microphone did.
 */
function friendlyStartError(error) {
  if (error?.name === 'NotAllowedError' || /permission|denied/i.test(error?.message ?? '')) {
    return 'Pip needs the microphone. Allow it in your browser and tap Start again.';
  }
  return error?.message ?? 'Pip could not start. Please try again.';
}

function describeEnding(reason) {
  return {
    pip: 'Pip finished the conversation and stopped listening.',
    parent: 'You finished the session. Pip has stopped listening.',
    silence: 'It went quiet, so Pip stopped listening.',
    hidden: 'The screen was away for a while, so Pip stopped listening.',
    too_long: 'That reached the fifteen minute limit, so Pip stopped listening.',
    error: 'Something went wrong, so Pip stopped listening.',
  }[reason] ?? 'Pip has stopped listening.';
}

/* --- ending -------------------------------------------------------------- */

// No PIN here, deliberately. Asking for one meant Pip kept talking and kept
// listening while it was typed, which is both the wrong behaviour and billed
// by the minute. Stopping is immediate; starting is what the PIN guards.
endButton.addEventListener('click', async () => {
  endButton.disabled = true;
  endButton.textContent = 'Finishing…';
  await session?.stop();
});

document.querySelector('#alert-ok').addEventListener('click', async () => {
  alertBox.classList.add('hidden');
  // Pip has already been told to stop the mediation, so close it properly
  // rather than leave a conversation open beside an upset child.
  await session?.stop();
});
