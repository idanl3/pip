import { requireSession } from './lib/auth.js';
import { loadFamily } from './lib/data.js';
import { supabase } from './lib/supabase.js';

/**
 * The launch screen.
 *
 * One button. This gets opened while two children are already shouting, so
 * everything a parent might want to read or change is behind the word
 * "Parents" in the corner, and nothing on this screen competes with Start.
 *
 * Nothing about the children appears here either. It used to print the whole
 * profile - each child's name, age, personality and what they do in a fight -
 * on the one screen a parent opens with those children next to them.
 */

const notice = document.querySelector('#notice');
const ready = document.querySelector('#ready');
const waiting = document.querySelector('#waiting');
const waitingTitle = document.querySelector('#waiting-title');
const waitingBody = document.querySelector('#waiting-body');
const waitingNote = document.querySelector('#waiting-note');
const minutesLine = document.querySelector('#minutes');

/**
 * What a family sees when they cannot start yet.
 *
 * "Waiting for admin to approve you" is the owner's wording. It says who is
 * holding things up and that somebody is, which is kinder than a status word
 * like "pending" that leaves a parent wondering whether it is broken.
 */
const BLOCKED = {
  pending: {
    title: 'Waiting for admin to approve you',
    body: 'Idan reads every profile before a family starts using Pip. You will be able to start a session once that is done.',
  },
  needs_changes: {
    title: 'Waiting for admin to approve you',
    body:
      'Idan has asked for a small change first. Open Parents, then your ' +
      "family's answers, to update them.",
  },
  suspended: {
    title: 'Paused',
    body: 'This account is paused. Talk to Idan if that is unexpected.',
  },
};

(async function start() {
  const session = await requireSession();
  if (!session) return;

  const family = await loadFamily();
  if (!family) {
    location.replace('/onboarding.html');
    return;
  }

  if (family.status === 'approved') {
    ready.classList.remove('hidden');
    await showMinutes(family);
    return;
  }

  const blocked = BLOCKED[family.status] ?? BLOCKED.pending;
  waitingTitle.textContent = blocked.title;
  waitingBody.textContent = blocked.body;
  if (family.status === 'needs_changes' && family.review_note) {
    waitingNote.textContent = `“${family.review_note}”`;
  }
  waiting.classList.remove('hidden');
})().catch((error) => {
  notice.textContent = error.message;
});

/**
 * Minutes left this month, in the footer rather than beside the button.
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

  const limit = data?.monthly_minute_limit ?? family.monthly_minute_limit;
  const left = Math.max(0, limit - (data?.minutes_used ?? 0));

  minutesLine.textContent =
    left > 0
      ? `${left} of ${limit} minutes left this month`
      : 'No minutes left this month. They reset on the first.';
}
