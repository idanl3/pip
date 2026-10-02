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
const alertBox = document.querySelector('#alert');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let blob = null;
let session = null;
const transcript = [];

function fail(message) {
  notice.textContent = message;
}

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

  await startSession();
})().catch((error) => fail(error.message));

async function startSession() {
  notice.textContent = '';

  stageLive.classList.remove('hidden');
  connectingLine.classList.remove('hidden');
  stageLive.dataset.state = 'connecting';
  conversationState = null;

  // The blob runs before the conversation connects, so the children see
  // something alive during the handshake rather than a blank screen.
  blob = new PipBlob(document.querySelector('#blob'), { reducedMotion });
  blob.setState('idle');
  blob.start();

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
    stageLive.classList.add('hidden');
    fail(friendlyStartError(error));
  }
}

/**
 * A refusal a parent can act on.
 *
 * The server already words these kindly; this adds the one thing it cannot
 * know, which is what the microphone did.
 */
function friendlyStartError(error) {
  if (error?.name === 'NotAllowedError' || /permission|denied/i.test(error?.message ?? '')) {
    return 'Pip needs the microphone. Allow it in your browser, then open Pip again.';
  }
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
