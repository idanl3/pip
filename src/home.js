import { requireSession, signOut, isAdmin } from './lib/auth.js';
import { loadFamily, describeStatus } from './lib/data.js';
import { supabase } from './lib/supabase.js';

/**
 * The parent's home screen.
 *
 * Status, minutes, and a way into Pip. Deliberately nothing about the
 * children.
 *
 * It used to print the whole profile here — each child's name, age,
 * personality and what they do in a fight. This is also the screen a parent
 * opens with the children standing next to them, and "cries and finds it hard
 * to stop" is not something a child should read about themselves over a
 * shoulder. Those answers are behind the PIN now, on the form where they were
 * written.
 */

const notice = document.querySelector('#notice');
const statusBox = document.querySelector('#status');
const statusTitle = document.querySelector('#status-title');
const statusBody = document.querySelector('#status-body');
const statusNote = document.querySelector('#status-note');
const startCard = document.querySelector('#start-card');
const minutesLine = document.querySelector('#minutes');

(async function start() {
  const session = await requireSession();
  if (!session) return;

  const family = await loadFamily();
  if (!family) {
    location.replace('/onboarding.html');
    return;
  }

  const state = describeStatus(family.status);
  statusBox.className = `notice notice--${state.tone}`;
  statusTitle.textContent = state.title;
  statusBody.textContent = state.body;

  if (family.status === 'needs_changes' && family.review_note) {
    statusNote.textContent = `“${family.review_note}”`;
  }

  if (family.status === 'approved') {
    startCard.classList.remove('hidden');
    await showMinutes(family);
  }

  // Shown only to the handful of people who can act on it. Courtesy, not
  // security: the admin screen and every table behind it refuse anyone else
  // whether or not this link is on the page.
  if (await isAdmin()) {
    document.querySelector('#admin-link').classList.remove('hidden');
  }
})().catch((error) => {
  notice.textContent = error.message;
});

/**
 * Minutes used and left this month.
 *
 * Read from the family_usage view, which derives the total from the sessions
 * rather than keeping a counter. A counter that has drifted is worse than
 * none: it either blocks a family with minutes left or bills one without.
 */
async function showMinutes(family) {
  const { data } = await supabase
    .from('family_usage')
    .select('minutes_used, monthly_minute_limit')
    .eq('family_id', family.id)
    .maybeSingle();

  const used = data?.minutes_used ?? 0;
  const limit = data?.monthly_minute_limit ?? family.monthly_minute_limit;
  const left = Math.max(0, limit - used);

  minutesLine.textContent =
    left > 0
      ? `${left} of ${limit} minutes left this month.`
      : 'No minutes left this month. They reset on the first.';
}

document.querySelector('#sign-out').addEventListener('click', async () => {
  await signOut();
  location.replace('/index.html');
});
