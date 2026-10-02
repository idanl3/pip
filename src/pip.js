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
 * Four stages on one page: the PIN, choosing who is involved, the blob, and a
 * visibly finished state. One page because the browser only grants the
 * microphone on a user gesture, and a gesture does not survive a navigation —
 * the parent's tap on Start has to be the tap that opens the conversation.
 */

const stages = {
  pin: document.querySelector('#stage-pin'),
  setup: document.querySelector('#stage-setup'),
  live: document.querySelector('#stage-live'),
  done: document.querySelector('#stage-done'),
};

const notice = document.querySelector('#notice');
const whoHost = document.querySelector('#who');
const contextInput = document.querySelector('#context');
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
let transcript = [];

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
  renderMinutes(family);

  // A PIN is per device, so a parent on a new phone sets one on arrival
  // rather than being locked out of their own account.
  if (isPinSet()) {
    preparePinEntry();
  } else {
    preparePinSetup();
  }
  show('pin');
})().catch((error) => fail(error.message));

function renderWho() {
  whoHost.replaceChildren(
    ...children.map((child) => {
      const label = document.createElement('label');
      label.className = 'chip';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = child.id;
      input.name = 'who';

      const span = document.createElement('span');
      span.textContent = `${child.first_name} (${child.age})`;

      label.append(input, span);
      return label;
    }),
  );
}

function renderMinutes(family) {
  minutesLine.textContent = `${family.monthly_minute_limit} minutes a month for your family.`;
}

/* --- the PIN ------------------------------------------------------------- */

const pinForm = document.querySelector('#pin-form');
const pinInput = document.querySelector('#pin');
const pinError = document.querySelector('#pin-error');
const pinHeading = document.querySelector('#pin-heading');
const pinExplainer = document.querySelector('#pin-explainer');
const pinSubmit = document.querySelector('#pin-submit');
const pinForgot = document.querySelector('#pin-forgot');

let pinMode = 'enter';

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

pinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  pinError.textContent = '';
  const value = pinInput.value.trim();

  const waiting = lockoutRemaining();
  if (waiting > 0) {
    pinError.textContent = `Too many tries. Wait ${waiting} seconds.`;
    return;
  }

  if (pinMode === 'create') {
    const problem = validatePin(value);
    if (problem) {
      pinError.textContent = problem;
      return;
    }
    await setPin(value);
    clearFailures();
    pinInput.value = '';
    show('setup');
    return;
  }

  pinSubmit.disabled = true;
  const ok = await verifyPin(value);
  pinSubmit.disabled = false;

  if (!ok) {
    const { locked } = recordFailure();
    pinError.textContent = locked
      ? 'Too many tries. Wait a minute.'
      : 'That is not the PIN.';
    pinInput.select();
    return;
  }

  clearFailures();
  pinInput.value = '';
  show('setup');
});

/* --- starting ------------------------------------------------------------ */

startButton.addEventListener('click', async () => {
  notice.textContent = '';
  const chosen = [...whoHost.querySelectorAll('input:checked')].map((i) => i.value);

  if (chosen.length === 0) {
    fail('Please tap who needs help.');
    return;
  }

  startButton.disabled = true;
  startButton.textContent = 'Asking Pip…';

  // The blob is created and running before the conversation connects, so the
  // children see something alive during the second or two of handshaking
  // rather than a blank screen.
  show('live');
  statusLine.textContent = 'Getting Pip…';
  blob = new PipBlob(document.querySelector('#blob'), { reducedMotion });
  blob.setState('idle');
  blob.start();

  session = new PipSession({
    onState: (state) => {
      blob?.setState(state === 'waiting' ? 'idle' : state);
      statusLine.textContent = {
        listening: 'Pip is listening',
        speaking: 'Pip is talking',
        thinking: 'Pip is thinking',
        ended: 'Pip has stopped listening',
      }[state] ?? '';
    },
    onLevels: (levels) => blob?.setLevels(levels),
    onTranscript: (turn) => {
      // Held in memory for phase 6's recap, which the browser will write and
      // encrypt itself. It is never uploaded from here and never logged.
      transcript.push(turn);
    },
    onSafetyAlert: () => {
      alertBox.classList.remove('hidden');
      document.querySelector('#alert-ok').focus();
    },
    onEnded: (reason) => {
      blob?.setState('ended');
      doneDetail.textContent = describeEnding(reason);
      // Let the blob visibly settle before swapping the screen. Cutting
      // straight to a panel loses the one cue a small child can read.
      setTimeout(() => {
        show('done');
        blob?.stop();
      }, 1800);
    },
    onError: (message) => fail(message),
  });

  try {
    await session.start({ childIds: chosen, context: contextInput.value.trim() });
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
 * The server already writes these kindly; this adds the one thing it cannot
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

// PIN-gated, because the whole point of a finish button a child can see is
// that pressing it should not work.
endButton.addEventListener('click', async () => {
  const entered = prompt('Parent PIN to finish the session:');
  if (entered === null) return;

  if (!(await verifyPin(entered.trim()))) {
    recordFailure();
    fail('That is not the PIN, so the session is still going.');
    return;
  }
  clearFailures();
  await session?.stop();
});

document.querySelector('#alert-ok').addEventListener('click', async () => {
  alertBox.classList.add('hidden');
  // Pip has already been told to stop the mediation, so end it properly
  // rather than leaving a conversation open next to an upset child.
  await session?.stop();
});
