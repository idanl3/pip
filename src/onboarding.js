import { requireSession, signOut } from './lib/auth.js';
import { requirePin, grantHandoff } from './lib/pin-gate.js';
import {
  loadFamily,
  loadChild,
  saveProfile,
  saveChild,
  saveHousehold,
  addChild as insertChild,
} from './lib/data.js';
import {
  PERSONALITY_SUGGESTIONS,
  CONFLICT_SUGGESTIONS,
  PARENT_NAME_SUGGESTIONS,
  RECURRING_CONFLICT_SUGGESTIONS,
  HOUSE_RULE_SUGGESTIONS,
} from './lib/suggestions.js';

/**
 * The onboarding form.
 *
 * Each free-text field is really a set of tappable suggestions plus a box for
 * the parent's own words. Both end up in one database column, joined with
 * "; ".
 *
 * The separator is a semicolon rather than a comma on purpose. Several
 * suggestions contain commas of their own — "Shy with new people, slow to warm
 * up" — so splitting on commas would tear them in half when the form is
 * reopened to edit. Nothing in any list contains a semicolon, which makes the
 * round trip exact.
 *
 * It has three views, and which one you get is the whole design.
 *
 * First run, with no family yet: everything, because this is where a profile
 * gets written.
 *
 * ?child=<id>, or ?child=new: one child, and nothing about the household.
 * Their name and age are filled in - the portal shows those already, and you
 * need them to know whose page you are on - but what was written about them is
 * not. Those two boxes start empty like every other, and for the same reason:
 * "cries and finds it hard to stop" is not a sentence a seven-year-old should
 * be able to read about themselves over a parent's shoulder, and the surest
 * way to stop that is for no screen to display it at all.
 *
 * An existing family, with no child named: the household questions only, and
 * every box empty. The children are not here at all; they live in the parents'
 * portal. Empty boxes are deliberate - a parent rewrites an answer rather than
 * editing one - which makes an empty box mean "leave this as it is", because
 * the alternative erases three answers for a parent who came to change one.
 */

const SEPARATOR = '; ';
const MAX_CHILDREN = 5;

/** The single child being fixed, or null for the whole-family form. */
const onlyChildId = new URLSearchParams(location.search).get('child');

const form = document.querySelector('#profile');
const notice = document.querySelector('#notice');
const reviewNote = document.querySelector('#review-note');
const childrenHost = document.querySelector('#children');
const template = document.querySelector('#child-template');
const submit = document.querySelector('#submit');

let uid = 0;

/** The signed-in parent's family, once loaded. Null on first run. */
let familyRow = null;

/* --- chips --------------------------------------------------------------- */

function renderChips(host, suggestions, name) {
  host.replaceChildren(
    ...suggestions.map((text) => {
      const label = document.createElement('label');
      label.className = 'chip';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = text;
      input.name = name;

      const span = document.createElement('span');
      span.textContent = text;

      label.append(input, span);
      return label;
    }),
  );
}

function chosen(host) {
  return [...host.querySelectorAll('input:checked')].map((i) => i.value);
}

/** Combines tapped suggestions and typed words into one stored value. */
function combine(host, textarea) {
  const parts = [...chosen(host)];
  const typed = textarea.value.trim();
  if (typed) parts.push(typed);
  return parts.join(SEPARATOR) || null;
}

/** The reverse, for reopening a saved profile. */
function split(value, host, textarea) {
  if (!value) return;
  const known = new Set(
    [...host.querySelectorAll('input')].map((i) => i.value),
  );
  const leftovers = [];

  for (const part of value.split(';').map((p) => p.trim()).filter(Boolean)) {
    if (known.has(part)) {
      host.querySelector(`input[value="${CSS.escape(part)}"]`).checked = true;
    } else {
      leftovers.push(part);
    }
  }
  textarea.value = leftovers.join(SEPARATOR);
}

/* --- children ------------------------------------------------------------ */

function addChild(child) {
  const node = template.content.firstElementChild.cloneNode(true);
  const id = ++uid;

  const name = node.querySelector('.js-name');
  const age = node.querySelector('.js-age');
  name.id = `child-name-${id}`;
  age.id = `child-age-${id}`;
  node.querySelector('.js-name-label').setAttribute('for', name.id);
  node.querySelector('.js-age-label').setAttribute('for', age.id);

  renderChips(node.querySelector('.js-personality-chips'), PERSONALITY_SUGGESTIONS, `personality-${id}`);
  renderChips(node.querySelector('.js-conflict-chips'), CONFLICT_SUGGESTIONS, `conflict-${id}`);

  if (child) {
    // The row id rides along on the block, so saving updates this child
    // rather than deleting every child and writing them all back.
    if (child.id) node.dataset.childId = child.id;
    name.value = child.first_name ?? '';
    age.value = child.age ?? '';
    split(child.personality, node.querySelector('.js-personality-chips'), node.querySelector('.js-personality-other'));
    split(child.conflict_tendency, node.querySelector('.js-conflict-chips'), node.querySelector('.js-conflict-other'));
  }

  node.querySelector('.js-remove').addEventListener('click', () => {
    node.remove();
    renumber();
  });

  childrenHost.append(node);
  renumber();
  return node;
}

function renumber() {
  const blocks = [...childrenHost.children];
  blocks.forEach((block, index) => {
    const nameValue = block.querySelector('.js-name').value.trim();
    block.querySelector('.child__number').textContent =
      nameValue || `Child ${index + 1}`;
    // With only one child left, removing it would leave nothing to mediate.
    block.querySelector('.js-remove').classList.toggle('hidden', blocks.length <= 1);
  });
  document
    .querySelector('#add-child')
    .classList.toggle('hidden', onlyChildId !== null || blocks.length >= MAX_CHILDREN);
}

document.querySelector('#add-child').addEventListener('click', () => {
  const block = addChild();
  // Put the cursor where they are going to type next. Without this the new
  // block appears below the fold on a phone and looks like nothing happened.
  block.querySelector('.js-name').focus();
  block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

// Keep the heading in step with the name as it is typed, so a parent scanning
// a long form can tell the blocks apart.
childrenHost.addEventListener('input', (event) => {
  if (event.target.classList.contains('js-name')) renumber();
});

/* --- load --------------------------------------------------------------- */

const parentChips = document.querySelector('#parent-chips');
const recurringChips = document.querySelector('#recurring-chips');
const rulesChips = document.querySelector('#rules-chips');
const parentOther = document.querySelector('#parent-other');
const recurringOther = document.querySelector('#recurring-other');
const rulesOther = document.querySelector('#rules-other');
const extraCare = document.querySelector('#extra-care');

renderChips(parentChips, PARENT_NAME_SUGGESTIONS, 'parent-names');
renderChips(recurringChips, RECURRING_CONFLICT_SUGGESTIONS, 'recurring');
renderChips(rulesChips, HOUSE_RULE_SUGGESTIONS, 'rules');

(async function start() {
  const session = await requireSession();
  if (!session) return;

  const family = await loadFamily();
  familyRow = family;

  // A profile that exists is a profile worth protecting. On first run there is
  // nothing here yet and the parent has just signed up, so asking for a PIN
  // they have not set would be a wall in front of an empty room.
  if (family) {
    await requirePin(document.querySelector('#stage-pin'), {
      heading: 'Parent PIN',
      explainer: 'These answers are about your children, so they stay behind the PIN.',
      acceptHandoff: true,
    });
  }
  document.querySelector('#form-area').classList.remove('hidden');

  if (family && family.status === 'needs_changes' && family.review_note) {
    reviewNote.textContent = `Idan asked for a change: ${family.review_note}`;
    reviewNote.classList.remove('hidden');
  }

  // --- one child, opened on purpose --------------------------------------
  if (onlyChildId && family) {
    const child = onlyChildId === 'new' ? null : await loadChild(onlyChildId);
    if (onlyChildId !== 'new' && !child) {
      location.replace('/parents.html');
      return;
    }

    hide('.js-household');
    document.querySelector('#lede').textContent = child
      ? 'What you wrote about them is not shown here. Leave a box empty and it ' +
        'stays as it is; write in one and it replaces what is there. Nothing ' +
        'about your other children is touched.'
      : 'Just this child. Nothing about the rest of your family is touched.';
    document.querySelector('#form-title').textContent = child
      ? `About ${child.first_name}`
      : 'Another child';
    document.title = `${document.querySelector('#form-title').textContent} — Pip`;
    submit.textContent = 'Save';

    // Name and age only. Deliberately not the description: a parent rewrites
    // what Pip knows rather than editing what they can read, and an empty box
    // leaves what is stored alone.
    const block = addChild(
      child ? { id: child.id, first_name: child.first_name, age: child.age } : undefined,
    );
    // Removing belongs in the portal, beside the other children, where the
    // consequence is in front of you.
    block.querySelector('.js-remove').classList.add('hidden');
    return;
  }

  // --- the household, rewritten from scratch -----------------------------
  if (family) {
    hide('.js-children');
    document.querySelector('#form-title').textContent = 'About your family';
    document.querySelector('#lede').textContent =
      'These are for Pip, not for your children. Anything you leave empty stays ' +
      'as it is, and anything you write replaces what is there.';
    submit.textContent = 'Save and send for approval';
    return;
  }

  {
    // Two is the common case for siblings, and an empty page is harder to
    // start from than a half-filled one.
    addChild();
    addChild();
    // Nowhere to go back to yet.
    document.querySelector('#back').classList.add('hidden');
  }
})().catch((error) => {
  notice.textContent = error.message;
});

function hide(selector) {
  for (const node of document.querySelectorAll(selector)) node.classList.add('hidden');
}

/* --- save --------------------------------------------------------------- */

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  notice.textContent = '';

  const parentNames = [
    ...chosen(parentChips),
    ...parentOther.value.split(',').map((s) => s.trim()).filter(Boolean),
  ];

  const children = [];
  let firstProblem = null;

  for (const block of childrenHost.children) {
    const nameInput = block.querySelector('.js-name');
    const ageInput = block.querySelector('.js-age');
    const error = block.querySelector('.js-child-error');
    const name = nameInput.value.trim();
    const age = Number.parseInt(ageInput.value, 10);

    error.textContent = '';
    nameInput.removeAttribute('aria-invalid');
    ageInput.removeAttribute('aria-invalid');

    if (!name) {
      error.textContent = 'Please add a first name, or remove this child.';
      nameInput.setAttribute('aria-invalid', 'true');
      firstProblem ??= nameInput;
      continue;
    }
    if (!Number.isInteger(age) || age < 1 || age > 18) {
      error.textContent = 'Please give an age between 1 and 18.';
      ageInput.setAttribute('aria-invalid', 'true');
      firstProblem ??= ageInput;
      continue;
    }

    children.push({
      id: block.dataset.childId || null,
      first_name: name,
      age,
      personality: combine(block.querySelector('.js-personality-chips'), block.querySelector('.js-personality-other')),
      conflict_tendency: combine(block.querySelector('.js-conflict-chips'), block.querySelector('.js-conflict-other')),
    });
  }

  if (firstProblem) {
    firstProblem.focus();
    notice.textContent = 'A couple of answers need a look before this can be sent.';
    return;
  }

  // One child: write just that row, or insert a new one. A trigger in the
  // database sends the family back for review either way, so a changed child
  // still gets looked at.
  if (onlyChildId) {
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      if (onlyChildId === 'new') await insertChild(familyRow.id, children[0]);
      else await saveChild(onlyChildId, children[0]);
      grantHandoff();
      location.replace('/parents.html');
    } catch (error) {
      notice.textContent = error.message;
      submit.disabled = false;
      submit.textContent = 'Save';
    }
    return;
  }

  // The household, on its own. The boxes started empty, so only what was
  // actually written gets sent: an empty box means "leave this as it is", not
  // "erase it". saveHousehold drops the empty ones.
  if (familyRow) {
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      await saveHousehold({
        parent_names: parentNames,
        recurring_conflicts: combine(recurringChips, recurringOther),
        house_rules: combine(rulesChips, rulesOther),
        extra_care: extraCare.value.trim() || null,
      });
      grantHandoff();
      location.replace('/parents.html');
    } catch (error) {
      notice.textContent = error.message;
      submit.disabled = false;
      submit.textContent = 'Save and send for approval';
    }
    return;
  }

  if (!parentNames.length) {
    notice.textContent = 'Please say what your children call you.';
    parentOther.focus();
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Sending…';

  try {
    await saveProfile(
      {
        parent_names: parentNames,
        language: 'en',
        recurring_conflicts: combine(recurringChips, recurringOther),
        house_rules: combine(rulesChips, rulesOther),
        extra_care: extraCare.value.trim() || null,
      },
      children,
    );
    location.replace('/home.html');
  } catch (error) {
    notice.textContent = error.message;
    notice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    submit.disabled = false;
    submit.textContent = 'Send for approval';
  }
});

document.querySelector('#back').addEventListener('click', grantHandoff);

document.querySelector('#sign-out').addEventListener('click', async () => {
  await signOut();
  location.replace('/index.html');
});
