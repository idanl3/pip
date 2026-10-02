import { requireSession } from './lib/auth.js';
import { loadFamily } from './lib/data.js';
import { PipBlob } from './lib/blob.js';
import { PipSession } from './lib/session.js';
import { requirePin } from './lib/pin-gate.js';

/**
 * Pip's own screen.
 *
 * PIN, then Pip. There is nothing in between on purpose: a fight is happening
 * while this is open, and the parent used to have to pick who was involved
 * from a list before anything could start. That selection told Pip nothing it
 * does not ask the children itself.
 *
 * The PIN guards starting. It does not guard finishing: a conversation nobody
 * wants should stop the moment somebody says so, and asking for a PIN first
 * meant Pip kept talking while it was typed. A child who ends a session has
 * broken nothing and cannot start another.
 *
 * It is asked for every session, with no remembered window. A window is the
 * obvious convenience and it is the wrong one here: the device is put down in
 * a room with the children in it the moment a session ends, and fifteen
 * remembered minutes is exactly when one of them would pick it up. Ending a
 * session leaves this page, so coming back always asks again.
 */

const stagePin = document.querySelector('#stage-pin');
const stageLive = document.querySelector('#stage-live');
const notice = document.querySelector('#notice');
const connectingLine = document.querySelector('#connecting');
const announce = document.querySelector('#announce');
const endButton = document.querySelector('#end');
const retryButton = document.querySelector('#retry');
const alertBox = document.querySelector('#alert');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let blob = null;
let session = null;
const transcript = [];

function fail(message, { offerRetry = false } = {}) {
  notice.textContent = message;
  retryButton.classList.toggle('hidden', !offerRetry);
}

// Reloading is the only thing that re-asks for a permission the browser has
// already answered, so this is a reload rather than a second attempt in place.
retryButton.addEventListener('click', () => location.reload());

/* --- is Pip talking? -----------------------------------------------------

   Derived from whether Pip's audio is actually flowing, not from the SDK's
   mode. The mode changes the moment the agent has finished generating, while
   the audio is still playing out, so following it made the blob flip to
   listening halfway through Pip's sentence and then back. Output volume is the
   honest signal, and a short hold stops the gaps between words counting as
   silence. */

const SPEAKING_THRESHOLD = 0.012;
const SPEAKING_HOLD_MS = 700;

let lastHeardPip = 0;
let conversationState = null;

function updateStateFromLevels({ output }) {
  if (output > SPEAKING_THRESHOLD) lastHeardPip = Date.now();
  const speaking = Date.now() - lastHeardPip < SPEAKING_HOLD_MS;
  setConversationState(speaking ? 'speaking' : 'listening');
}

function setConversationState(state) {
  if (state === conversationState) return;
  conversationState = state;
  blob?.setState(state);
  // Not shown to anyone. This is how the tests can see what the blob is doing,
  // now that there is deliberately no caption to read.
  stageLive.dataset.state = state;
}

/* --- the journey --------------------------------------------------------- */

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

  // Resolves inside the tap that accepted the PIN, which is what lets the
  // browser grant the microphone immediately afterwards.
  await requirePin(stagePin, {
    heading: 'Parent PIN',
    explainer: 'So a session can only be started by you.',
  });

  // The blob first, so there is something alive on screen behind the
  // permission prompt rather than an empty page. Synchronous, so it costs the
  // tap's user activation nothing.
  showStage();

  // The microphone, now, before anything slow happens.
  try {
    await askForMicrophone();
  } catch (error) {
    stageLive.classList.add('hidden');
    blob?.stop();
    blob = null;
    fail(microphoneProblem(error), { offerRetry: true });
    return;
  }

  await startSession();
})().catch((error) => fail(error.message));

/* --- the microphone ------------------------------------------------------

   Asked for here rather than left to the voice SDK, which requests it only
   after our edge function has issued a conversation token - a round trip, and
   a cold start on a free plan.

   On Android Chrome that is too late. The permission prompt needs the tap that
   accepted the PIN to still count as user activation, and that expires in a
   few seconds; past it Chrome refuses the request outright instead of asking.
   The parent sees "allow it in your browser" having never been offered the
   chance, which is exactly what happened on the owner's phone.

   None of the browser tests could have caught it: they run Chrome with
   --use-fake-ui-for-media-stream, which grants the microphone without asking
   and therefore without caring when it was asked. */

/**
 * Asks, then hands the device straight back.
 *
 * Only the permission is wanted here, not the audio: the SDK opens its own
 * capture a moment later and a granted microphone stays granted for the page.
 * Holding the track open until then was the first attempt and is worse - some
 * Android devices will not give the same microphone to a second capture, so
 * keeping it would risk breaking the very thing this is fixing.
 */
async function askForMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('no microphone API'), { name: 'NotSupportedError' });
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
}

/** Each of these is a different thing for a parent to do about it. */
function microphoneProblem(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return (
        'Pip needs the microphone. Tap the icon at the left of the address ' +
        'bar, allow the microphone for this site, then try again.'
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return (
        'Something else is using the microphone. Close any other call or ' +
        'recording app, then try again.'
      );
    case 'NotSupportedError':
      return 'This browser cannot reach the microphone. Chrome or Safari will work.';
    default:
      return `The microphone could not be opened (${error?.name ?? 'unknown error'}).`;
  }
}

/** The blob, running, before anything can go wrong. */
function showStage() {
  fail('');
  stageLive.classList.remove('hidden');
  connectingLine.classList.remove('hidden');
  stageLive.dataset.state = 'connecting';
  conversationState = null;

  // The children see something alive during the permission prompt and the
  // handshake, rather than a blank screen.
  blob = new PipBlob(document.querySelector('#blob'), { reducedMotion });
  blob.setState('idle');
  blob.start();
}

async function startSession() {
  session = new PipSession({
    onState: (state) => {
      if (state === 'connected') {
        // The words go away the moment there is a blob to watch instead.
        connectingLine.classList.add('hidden');
        announce.textContent = 'Pip is listening.';
        setConversationState('listening');
      }
    },
    onLevels: (levels) => {
      blob?.setLevels(levels);
      if (conversationState !== null) updateStateFromLevels(levels);
    },
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
      // The blob settling, shrinking and fading is the ended state. After it,
      // the page takes itself home rather than offering a panel to dismiss.
      conversationState = 'ended';
      blob?.setState('ended');
      stageLive.dataset.state = 'ended';
      connectingLine.classList.add('hidden');
      announce.textContent = 'Pip has stopped listening.';
      endButton.classList.add('hidden');

      // An error is the exception: leaving would hide the only explanation.
      if (reason === 'error') return;

      setTimeout(() => {
        blob?.stop();
        location.replace('/home.html');
      }, 2600);
    },
    onError: (message) => fail(message),
  });

  try {
    await session.start();
  } catch (error) {
    blob?.stop();
    blob = null;
    stageLive.classList.add('hidden');
    fail(friendlyStartError(error), { offerRetry: isMicrophoneError(error) });
  }
}

/**
 * A refusal a parent can act on.
 *
 * This used to match /permission|denied/ against the message as well as the
 * error name, which was far too wide. Any refusal that happened to use either
 * word - a database policy declining a row, a token refused upstream - was
 * reported to the parent as a microphone problem, so they went hunting through
 * browser settings for something that was never wrong. The message now only
 * mentions the microphone when the microphone is what failed.
 */
const MICROPHONE_ERRORS = [
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'SecurityError',
  'OverconstrainedError',
  'AbortError',
  'NotSupportedError',
];

function isMicrophoneError(error) {
  return MICROPHONE_ERRORS.includes(error?.name);
}

function friendlyStartError(error) {
  if (isMicrophoneError(error)) return microphoneProblem(error);
  return error?.message ?? 'Pip could not start. Please try again.';
}

/* --- ending -------------------------------------------------------------- */

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
