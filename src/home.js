import { requireSession, signOut } from './lib/auth.js';
import { loadFamily, loadChildren, describeStatus } from './lib/data.js';

const notice = document.querySelector('#notice');
const statusBox = document.querySelector('#status');
const statusTitle = document.querySelector('#status-title');
const statusBody = document.querySelector('#status-body');
const statusNote = document.querySelector('#status-note');
const familyBox = document.querySelector('#family');
const startCard = document.querySelector('#start-card');

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
  }

  const children = await loadChildren(family.id);
  render(family, children);
})().catch((error) => {
  notice.textContent = error.message;
});

function render(family, children) {
  familyBox.replaceChildren();

  familyBox.append(
    line('They call you', (family.parent_names ?? []).join(' and ') || '—'),
    line(
      'Minutes',
      `${family.monthly_minute_limit} a month`,
    ),
  );

  for (const child of children) {
    const block = document.createElement('div');
    block.style.marginBlockStart = '0.9rem';

    const heading = document.createElement('p');
    heading.style.margin = '0';
    heading.append(strong(`${child.first_name}, ${child.age}`));
    block.append(heading);

    if (child.personality) block.append(small(child.personality));
    if (child.conflict_tendency) block.append(small(`In a fight: ${child.conflict_tendency}`));

    familyBox.append(block);
  }

  if (family.recurring_conflicts) familyBox.append(line('They argue about', family.recurring_conflicts));
  if (family.house_rules) familyBox.append(line('House rules', family.house_rules));
  if (family.extra_care) familyBox.append(line('Extra care', family.extra_care));
}

function line(label, value) {
  const p = document.createElement('p');
  p.style.margin = '0.35rem 0 0';
  p.append(strong(`${label}: `), document.createTextNode(value));
  return p;
}

function strong(text) {
  const el = document.createElement('strong');
  el.textContent = text;
  return el;
}

function small(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.margin = '0.15rem 0 0';
  p.textContent = text;
  return p;
}

document.querySelector('#sign-out').addEventListener('click', async () => {
  await signOut();
  location.replace('/index.html');
});
