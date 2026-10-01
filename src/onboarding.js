import { requireSession, signOut } from './lib/auth.js';
import { loadFamily, loadChildren, saveProfile } from './lib/data.js';
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
 */

const SEPARATOR = '; ';
const MAX_CHILDREN = 5;

const form = document.querySelector('#profile');
const notice = document.querySelector('#notice');
const reviewNote = document.querySelector('#review-note');
const childrenHost = document.querySelector('#children');
const template = document.querySelector('#child-template');
const submit = document.querySelector('#submit');

let uid = 0;

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
  document.querySelector('#add-child').classList.toggle('hidden', blocks.length >= MAX_CHILDREN);
}

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

  if (family) {
    submit.textContent = 'Save and send for approval';

    for (const word of family.parent_names ?? []) {
      const chip = parentChips.querySelector(`input[value="${CSS.escape(word)}"]`);
      if (chip) chip.checked = true;
      else parentOther.value = parentOther.value ? `${parentOther.value}, ${word}` : word;
    }

    split(family.recurring_conflicts, recurringChips, recurringOther);
    split(family.house_rules, rulesChips, rulesOther);
    extraCare.value = family.extra_care ?? '';

    if (family.status === 'needs_changes' && family.review_note) {
      reviewNote.textContent = `Idan asked for a change: ${family.review_note}`;
      reviewNote.classList.remove('hidden');
    }

    const kids = await loadChildren(family.id);
    if (kids.length) kids.forEach(addChild);
    else addChild();
  } else {
    // Two is the common case for siblings, and an empty page is harder to
    // start from than a half-filled one.
    addChild();
    addChild();
  }
})().catch((error) => {
  notice.textContent = error.message;
});

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

document.querySelector('#sign-out').addEventListener('click', async () => {
  await signOut();
  location.replace('/index.html');
});
