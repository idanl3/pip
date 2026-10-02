import { requireSession, signOut, isAdmin } from './lib/auth.js';
import { requirePin, grantHandoff } from './lib/pin-gate.js';
import { loadFamily, loadChildren, describeStatus } from './lib/data.js';
import { clearPin } from './lib/pin.js';
import {
  markGranted,
  siteState,
  wasEverGranted,
  explainRefusal,
  refusalDetail,
  renderRefusal,
} from './lib/microphone.js';
import { supabase } from './lib/supabase.js';

/**
 * The parents' portal.
 *
 * The launch screen is one button, so everything else lives here: where the
 * family stands, minutes left, the children, the PIN, signing out.
 *
 * It is behind the PIN without exception. What a parent wrote about each child
 * is here, and the whole reason it moved off the launch screen is that a child
 * could read it over a shoulder. The children are listed by name and age only;
 * the descriptions appear only on the form for the one child being changed.
 */

const notice = document.querySelector('#notice');
const statusTitle = document.querySelector('#status-title');
const statusBody = document.querySelector('#status-body');
const reviewNote = document.querySelector('#review-note');
const minutesLine = document.querySelector('#minutes');
const kidsHost = document.querySelector('#kids');
const micState = document.querySelector('#mic-state');
const micHelp = document.querySelector('#mic-help');
const micCheck = document.querySelector('#mic-check');

(async function start() {
  const session = await requireSession();
  if (!session) return;

  const family = await loadFamily();
  if (!family) {
    location.replace('/onboarding.html');
    return;
  }

  await requirePin(document.querySelector('#stage-pin'), {
    heading: 'Parent PIN',
    explainer: "This is the parents' side of Pip.",
    acceptHandoff: true,
  });
  document.querySelector('#portal').classList.remove('hidden');

  const status = describeStatus(family.status);
  statusTitle.textContent = status.title;
  statusBody.textContent = status.body;
  if (family.status === 'needs_changes' && family.review_note) {
    reviewNote.textContent = `Idan's note: ${family.review_note}`;
    reviewNote.classList.remove('hidden');
  }

  await showMinutes(family);
  renderKids(await loadChildren(family.id));

  await showMicrophone();

  if (await isAdmin()) {
    document.querySelector('#admin-link').classList.remove('hidden');
  }
})().catch((error) => {
  notice.textContent = error.message;
});

async function showMinutes(family) {
  const { data } = await supabase
    .from('family_usage')
    .select('minutes_used, monthly_minute_limit')
    .eq('family_id', family.id)
    .maybeSingle();

  const limit = data?.monthly_minute_limit ?? family.monthly_minute_limit;
  const used = data?.minutes_used ?? 0;

  minutesLine.textContent = `${used} used, ${Math.max(0, limit - used)} of ${limit} left`;
}

/**
 * Names and ages. Nothing else.
 *
 * Fixing one child at a time is the point of the link: correcting an age used
 * to mean reopening the whole form, which put every child's description on
 * screen and wrote all of them back over themselves.
 */
function renderKids(kids) {
  kidsHost.replaceChildren(
    ...kids.map((kid) => {
      const row = document.createElement('div');
      row.className = 'kid-row';

      const name = document.createElement('p');
      name.className = 'kid-row__name';
      name.append(document.createTextNode(kid.first_name));

      const age = document.createElement('span');
      age.className = 'kid-row__age';
      age.textContent = ` · ${kid.age}`;
      name.append(age);

      const link = document.createElement('a');
      link.className = 'btn btn--link';
      link.href = `/onboarding.html?child=${encodeURIComponent(kid.id)}`;
      link.textContent = 'Change';

      row.append(name, link);
      return row;
    }),
  );
}

/**
 * Leaving for one of the forms.
 *
 * They are part of the same parent area and sit behind the same PIN, which was
 * typed to get here. Asking for it again one tap later only teaches parents to
 * pick a PIN they do not mind typing twice.
 */
document.querySelector('#portal').addEventListener('click', (event) => {
  if (event.target.closest('a[href^="/onboarding.html"]')) grantHandoff();
});

/* --- the microphone ------------------------------------------------------

   Checked here, where it costs nothing, rather than discovered on the kids'
   screen in the middle of a fight. A web page cannot grant itself a
   permission the phone has withheld - that is the point of a permission - so
   the most useful thing it can do is find out early and say exactly which
   setting is in the way. */

async function showMicrophone() {
  const state = await siteState();

  if (state === 'granted' || wasEverGranted()) {
    micState.textContent = 'Pip can hear you on this device.';
    micState.classList.add('mic__state--ok');
    micCheck.textContent = 'Check again';
    return;
  }

  micState.textContent =
    state === 'denied'
      ? 'This device has blocked the microphone.'
      : 'Not checked on this device yet.';
  micState.classList.remove('mic__state--ok');
}

/**
 * The request goes first, with nothing in front of it.
 *
 * A browser only grants a microphone during a tap, and anything slow before
 * the request - a database read, a round trip - can cost the prompt.
 */
micCheck.addEventListener('click', () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    micState.textContent = 'This browser cannot reach the microphone.';
    return;
  }
  runCheck(navigator.mediaDevices.getUserMedia({ audio: true }), performance.now());
});

async function runCheck(asking, started) {
  micCheck.disabled = true;
  micState.textContent = 'Asking\u2026';

  try {
    const stream = await asking;
    for (const track of stream.getTracks()) track.stop();
    // So the launch screen stops suggesting a check that has already passed.
    markGranted();
  } catch (error) {
    error.pipElapsedMs ??= Math.round(performance.now() - started);
    renderRefusal(micHelp, await explainRefusal(error), await refusalDetail(error));
    micHelp.classList.remove('hidden');
    micCheck.disabled = false;
    await showMicrophone();
    return;
  }

  micHelp.classList.add('hidden');
  micCheck.disabled = false;
  await showMicrophone();
}

/**
 * Setting a new PIN.
 *
 * Clearing the stored hash is enough: the gate offers to choose one when there
 * is none, so this hands straight back to the same keypad in its setting mood.
 * The old PIN is not asked for, because it was already asked for to get here.
 */
document.querySelector('#change-pin').addEventListener('click', async () => {
  clearPin();
  document.querySelector('#portal').classList.add('hidden');
  await requirePin(document.querySelector('#stage-pin'));
  document.querySelector('#portal').classList.remove('hidden');
  notice.className = 'notice notice--info';
  notice.textContent = 'PIN changed on this device.';
});

document.querySelector('#sign-out').addEventListener('click', async () => {
  await signOut();
  location.replace('/index.html');
});
