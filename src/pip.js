import { requireSession } from './lib/auth.js';
import { loadFamily, minutesLeft } from './lib/data.js';
import { PipBlob } from './lib/blob.js';
import { PipSession } from './lib/session.js';
import { requirePin } from './lib/pin-gate.js';
import {
  requestMicrophone,
  isMicrophoneError,
  explainRefusal,
  refusalDetail,
  renderRefusal,
  supportsGrantControl,
  wireGrantControl,
} from './lib/microphone.js';

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
const micHelp = document.querySelector('#mic-help');
const micGrant = document.querySelector('#mic-grant');
const stageMinutes = document.querySelector('#stage-minutes');
const alertBox = document.querySelector('#alert');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let blob = null;
let session = null;
const transcript = [];

/**
 * Two kinds of failure, because they need two different things from a parent.
 *
 * Anything we got wrong gets a sentence. A microphone refusal gets a short
 * list of steps, because the fix is on a settings screen somewhere and a
 * paragraph describing three of them is a paragraph nobody finishes.
 */
let retryAction = 'reload';

function fail(message) {
  notice.textContent = message;
  micHelp.classList.add('hidden');
  micGrant.classList.add('hidden');
  retryAction = 'reload';
  retryButton.textContent = 'Try again';
  retryButton.classList.toggle('hidden', !message);
}

async function failMicrophone(error) {
  notice.textContent = '';
  renderRefusal(micHelp, await explainRefusal(error), await refusalDetail(error));
  micHelp.classList.remove('hidden');

  // Chrome's own control first, where it exists: tapping it opens the
  // browser's recovery flow, which is a tap rather than a trip through
  // settings. Our own button stays underneath, because the control cannot
  // overrule an operating system that has taken the microphone away.
  micGrant.classList.toggle('hidden', !supportsGrantControl());

  retryAction = 'microphone';
  retryButton.textContent = 'Check again';
  retryButton.classList.remove('hidden');
}

if (supportsGrantControl()) {
  wireGrantControl(micGrant, {
    onGranted: async () => {
      fail('');
      showStage();
      await startSession();
    },
    onRefused: (error) => failMicrophone(error),
  });
}

/**
 * Checking again, with nothing in front of the request.
 *
 * getUserMedia is the first thing this click does - no await, no network, no
 * work of any kind before it. That started as an experiment, to find out
 * whether something this page did before asking was costing the prompt. It was
 * not: a click that asks for nothing else is still refused on a device whose
 * microphone is switched off somewhere outside the browser. It stays because
 * it is also the right shape - a parent who has just changed a setting should
 * get back into the session with one tap rather than starting over.
 */
retryButton.addEventListener('click', () => {
  if (retryAction !== 'microphone' || !navigator.mediaDevices?.getUserMedia) {
    location.reload();
    return;
  }
  const started = performance.now();
  continueAfterMicrophone(navigator.mediaDevices.getUserMedia({ audio: true }), started);
});

async function continueAfterMicrophone(asking, started) {
  retryButton.disabled = true;
  try {
    const stream = await asking;
    for (const track of stream.getTracks()) track.stop();
  } catch (error) {
    error.pipElapsedMs = Math.round(performance.now() - started);
    retryButton.disabled = false;
    await failMicrophone(error);
    return;
  }

  retryButton.disabled = false;
  fail('');
  showStage();
  await startSession();
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

  // Read before the PIN, not after. Anything slow between the tap that accepts
  // the PIN and the microphone request puts the permission prompt at risk.
  const left = await minutesLeft(family);

  // Resolves inside the tap that accepted the PIN, which is what lets the
  // browser grant the microphone immediately afterwards.
  await requirePin(stagePin, {
    heading: 'Parent PIN',
    explainer: 'So a session can only be started by you.',
  });

  // Not enough left to finish a session? Say so, and let the adult decide.
  // After the PIN on purpose: it is a decision about money and about whether a
  // mediation can run to the end, and it is not for the children.
  if (left < LOW_MINUTES) await approveShortMonth(left);

  // The microphone, with nothing between it and the tap that accepted either
  // the PIN or that warning. Raising the blob was here and has moved below: it is only a few
  // milliseconds of canvas work, but a permission request wants nothing at all
  // in front of it.
  //
  // By the time a family reaches this screen the microphone has usually been
  // granted already, in the parents' portal, on a quiet afternoon. That is the
  // whole point of the check being there: finding out that a phone has its
  // microphone switched off is survivable on a Tuesday and is not survivable
  // with two children shouting.
  try {
    await requestMicrophone();
  } catch (error) {
    await failMicrophone(error);
    return;
  }

  showStage();

  await startSession();
})().catch((error) => fail(error.message));

/* --- not much left this month -------------------------------------------

   A session can run for fifteen minutes, so fewer than fifteen in the bank
   means it might stop in the middle of a mediation. That is worse than never
   starting: two children left mid-argument by a helper that vanished.

   So the adult is told and has to choose. Resolving inside the tap keeps the
   microphone grantable afterwards, exactly as the PIN gate does. */

const LOW_MINUTES = 15;

function approveShortMonth(left) {
  stageMinutes.classList.remove('hidden');

  const title = document.querySelector('#minutes-title');
  const body = document.querySelector('#minutes-body');
  const go = document.querySelector('#minutes-go');
  const back = document.querySelector('#minutes-back');

  if (left <= 0) {
    title.textContent = 'No minutes left this month';
    body.textContent = 'They reset on the first. If you need more before then, ask Idan.';
    go.classList.add('hidden');
  } else {
    title.textContent = `${left} ${left === 1 ? 'minute' : 'minutes'} left this month`;
    body.textContent =
      'A session can run up to fifteen minutes, so this one might not reach the ' +
      'end. Minutes reset on the first, and Idan can add more.';
  }

  return new Promise((resolve) => {
    back.addEventListener('click', () => location.replace('/home.html'));
    go.addEventListener('click', () => {
      stageMinutes.classList.add('hidden');
      resolve();
    });
  });
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
    if (isMicrophoneError(error)) await failMicrophone(error);
    else fail(error?.message ?? 'Pip could not start. Please try again.');
  }
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
