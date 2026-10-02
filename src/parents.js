import { requireSession, signOut, isAdmin } from './lib/auth.js';
import { requirePin, grantHandoff } from './lib/pin-gate.js';
import { loadFamily, loadChildren, removeChild, describeStatus } from './lib/data.js';
import { clearPin } from './lib/pin.js';
import {
  markGranted,
  siteState,
  wasEverGranted,
  explainRefusal,
  refusalDetail,
  renderRefusal,
  supportsGrantControl,
  wireGrantControl,
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
const micGrant = document.querySelector('#mic-grant');

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
  await showKids(family);

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
 * Names and ages, and the two things you can do to a child.
 *
 * This is the only list of children a parent sees now. Opening one shows what
 * was written about them; nothing else does, and nothing shows two children's
 * descriptions at once.
 */
async function showKids(family) {
  const kids = await loadChildren(family.id);

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

      const actions = document.createElement('div');
      actions.className = 'kid-row__actions';

      const change = document.createElement('a');
      change.className = 'btn btn--link';
      change.href = `/onboarding.html?child=${encodeURIComponent(kid.id)}`;
      change.textContent = 'Change';
      actions.append(change);

      // Only when there is more than one. A family with no children cannot be
      // mediated, and removing the last one would be a dead end.
      if (kids.length > 1) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn--link';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          if (!confirm(`Remove ${kid.first_name}? What Pip knows about them goes too.`)) return;
          remove.disabled = true;
          try {
            await removeChild(family.id, kid.id);
            await showKids(family);
          } catch (error) {
            notice.textContent = error.message;
            remove.disabled = false;
          }
        });
        actions.append(remove);
      }

      row.append(name, actions);
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

  // Where the browser has its own grant control, use that instead of ours.
  // A tap on it is a trusted signal Chrome will honour even when it has
  // decided to suppress script-triggered prompts, and where the microphone
  // was already refused it opens Chrome's recovery flow rather than sending a
  // parent into settings.
  const browserOwned = supportsGrantControl() && state !== 'granted' && !wasEverGranted();
  micGrant.classList.toggle('hidden', !browserOwned);
  micCheck.classList.toggle('hidden', browserOwned);

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

if (supportsGrantControl()) {
  wireGrantControl(micGrant, {
    onGranted: async () => {
      micHelp.classList.add('hidden');
      markGranted();
      await showMicrophone();
    },
    onRefused: async (error) => {
      renderRefusal(micHelp, await explainRefusal(error), await refusalDetail(error));
      micHelp.classList.remove('hidden');
      await showMicrophone();
    },
  });
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
