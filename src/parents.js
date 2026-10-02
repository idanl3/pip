import { requireSession, signOut, isAdmin } from './lib/auth.js';
import { requirePin, grantHandoff } from './lib/pin-gate.js';
import { loadFamily, loadChildren, describeStatus } from './lib/data.js';
import { clearPin } from './lib/pin.js';
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
