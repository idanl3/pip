import { requireSession, isAdmin } from './lib/auth.js';
import {
  listFamilies,
  setStatus,
  setMinuteLimit,
  createInvite,
  listInvites,
  deleteInvite,
  inviteLink,
  loadPracticeNotes,
  savePracticeNotes,
} from './lib/admin.js';
import { buildGeneratorPrompt } from './lib/practice-notes.js';

const notice = document.querySelector('#notice');
const familiesHost = document.querySelector('#families');
const invitesHost = document.querySelector('#invites');

(async function start() {
  const session = await requireSession();
  if (!session) return;

  // This check is courtesy, not security: it saves a non-admin from staring
  // at an empty page wondering what broke. The database refuses them either
  // way, whatever this page decides to render.
  if (!(await isAdmin())) {
    location.replace('/home.html');
    return;
  }

  await refresh();
})().catch(fail);

let practiceNotes = new Map();

async function refresh() {
  const [families, invites, notes] = await Promise.all([
    listFamilies(),
    listInvites(),
    loadPracticeNotes(),
  ]);
  practiceNotes = notes;
  renderInvites(invites);
  renderFamilies(families);
}

/* --- invitations --------------------------------------------------------- */

document.querySelector('#make-invite').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const labelInput = document.querySelector('#invite-label');
  button.disabled = true;
  notice.textContent = '';

  try {
    await createInvite(labelInput.value);
    labelInput.value = '';
    await refresh();
  } catch (error) {
    fail(error);
  } finally {
    button.disabled = false;
  }
});

function renderInvites(invites) {
  invitesHost.replaceChildren();
  const open = invites.filter((i) => !i.used_at && new Date(i.expires_at) > new Date());
  const spent = invites.filter((i) => i.used_at);

  if (!invites.length) {
    invitesHost.append(muted('No invitations yet.'));
    return;
  }

  for (const invite of open) {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('p');
    title.className = 'card__title';
    title.textContent = invite.label || 'Unlabelled invitation';
    card.append(title);

    const link = inviteLink(invite.code);

    const linkBox = document.createElement('input');
    linkBox.type = 'text';
    linkBox.readOnly = true;
    linkBox.value = link;
    linkBox.addEventListener('focus', () => linkBox.select());
    card.append(linkBox);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.style.marginBlockStart = '0.75rem';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy link'), 1500);
      } catch {
        // Clipboard access can be refused. Selecting the text is a fine
        // fallback and needs no permission.
        linkBox.focus();
      }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--link';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!confirm('Delete this invitation? The link will stop working.')) return;
      try {
        await deleteInvite(invite.code);
        await refresh();
      } catch (error) {
        fail(error);
      }
    });

    actions.append(copy, remove);
    card.append(actions);

    card.append(
      muted(
        `Expires ${new Date(invite.expires_at).toLocaleDateString()} · code ${invite.code}`,
      ),
    );

    invitesHost.append(card);
  }

  if (spent.length) {
    invitesHost.append(
      muted(
        `${spent.length} invitation${spent.length === 1 ? '' : 's'} already used.`,
      ),
    );
  }
}

/* --- families ------------------------------------------------------------ */

function renderFamilies(families) {
  familiesHost.replaceChildren();

  if (!families.length) {
    familiesHost.append(muted('No families yet. Create an invitation above.'));
    return;
  }

  // Anything waiting on a decision goes first; it is the only reason to open
  // this page on a normal day.
  const order = { pending: 0, needs_changes: 1, approved: 2, suspended: 3 };
  families.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  for (const family of families) {
    familiesHost.append(familyCard(family));
  }
}

function familyCard(family) {
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('p');
  title.className = 'card__title';
  title.textContent = `${(family.parent_names ?? []).join(' and ') || 'Unnamed'} · ${label(family.status)}`;
  card.append(title);

  card.append(muted(`Joined ${new Date(family.created_at).toLocaleDateString()}`));

  for (const child of family.children ?? []) {
    const block = document.createElement('div');
    block.style.marginBlockStart = '0.75rem';

    const head = document.createElement('p');
    head.style.margin = '0';
    const name = document.createElement('strong');
    name.textContent = `${child.first_name}, ${child.age}`;
    head.append(name);
    block.append(head);

    if (child.personality) block.append(muted(child.personality));
    if (child.conflict_tendency) block.append(muted(`In a fight: ${child.conflict_tendency}`));
    card.append(block);
  }

  if (family.recurring_conflicts) card.append(detail('Argues about', family.recurring_conflicts));
  if (family.house_rules) card.append(detail('House rules', family.house_rules));
  if (family.extra_care) card.append(detail('Extra care', family.extra_care));
  if (family.review_note) card.append(detail('Your note', family.review_note));

  card.append(practiceSection(family));

  /* Minute limit */
  const limitRow = document.createElement('div');
  limitRow.className = 'row';
  limitRow.style.marginBlockStart = '1rem';
  limitRow.style.alignItems = 'flex-end';

  const limitWrap = document.createElement('div');
  limitWrap.className = 'width-short';
  const limitLabel = document.createElement('label');
  limitLabel.className = 'field__label';
  limitLabel.textContent = 'Minutes';
  limitLabel.setAttribute('for', `limit-${family.id}`);
  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.id = `limit-${family.id}`;
  limitInput.min = '0';
  limitInput.max = '10000';
  limitInput.value = family.monthly_minute_limit;
  limitWrap.append(limitLabel, limitInput);

  const saveLimit = button('Save', 'btn btn--quiet', async () => {
    const minutes = Number.parseInt(limitInput.value, 10);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10000) {
      fail(new Error('Minutes must be a whole number between 0 and 10000.'));
      return;
    }
    await act(() => setMinuteLimit(family.id, minutes));
  });

  limitRow.append(limitWrap, saveLimit);
  card.append(limitRow);

  /* Decisions */
  const actions = document.createElement('div');
  actions.className = 'actions';

  if (family.status !== 'approved') {
    actions.append(
      button('Approve', 'btn', () => act(() => setStatus(family.id, 'approved', null))),
    );
  }

  actions.append(
    button('Send back', 'btn btn--quiet', () => {
      const note = prompt(
        'What should they change? The parent sees this wording, so keep it kind.',
      );
      if (note === null) return;
      if (!note.trim()) {
        fail(new Error('A note is needed, otherwise they will not know what to fix.'));
        return;
      }
      return act(() => setStatus(family.id, 'needs_changes', note.trim()));
    }),
  );

  if (family.status === 'suspended') {
    actions.append(
      button('Un-pause', 'btn btn--quiet', () => act(() => setStatus(family.id, 'pending', null))),
    );
  } else {
    actions.append(
      button('Pause', 'btn btn--link', () => {
        if (!confirm('Pause this family? They will not be able to start a session or edit anything.')) return;
        return act(() => setStatus(family.id, 'suspended', family.review_note));
      }),
    );
  }

  card.append(actions);
  return card;
}


/**
 * The "what this profile means in practice" section for one family.
 *
 * This is the step that cannot be automated away yet: turning a profile into
 * instructions is a professional judgement, and the owner is the one who knows
 * the method. So the screen does the tedious part - assembling the whole
 * method, the family's facts and four examples of the standard to match into
 * one block - and the owner pastes that into an AI, reads what comes back, and
 * saves it.
 *
 * Without notes a family still works: the prompt falls back to the general
 * rules. With them, Pip adapts to these particular children, which is what
 * made it handle a five-year-old properly in the first place.
 */
function practiceSection(family) {
  const existing = practiceNotes.get(family.id);

  const wrap = document.createElement('div');
  wrap.style.marginBlockStart = '1rem';

  const title = document.createElement('p');
  title.style.margin = '0 0 0.25rem';
  const strong = document.createElement('strong');
  strong.textContent = 'What this profile means in practice';
  title.append(strong);
  wrap.append(title);

  wrap.append(
    muted(
      existing
        ? `Saved ${new Date(existing.updated_at).toLocaleDateString()}. Pip uses this.`
        : 'Not written yet. Pip is falling back to the general rules, which do not name your children.',
    ),
  );

  const box = document.createElement('textarea');
  box.value = existing?.notes ?? '';
  box.rows = existing ? 6 : 3;
  box.placeholder = 'Paste what the AI gives you back here.';
  box.style.marginBlockStart = '0.5rem';
  wrap.append(box);

  const row = document.createElement('div');
  row.className = 'actions';
  row.style.marginBlockStart = '0.5rem';

  const copy = button('Copy the prompt for an AI', 'btn btn--quiet', async () => {
    const text = buildGeneratorPrompt(family, family.children ?? []);
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied - paste it into Claude';
      setTimeout(() => (copy.textContent = 'Copy the prompt for an AI'), 2500);
    } catch {
      // Clipboard access can be refused. Showing the text is a fine fallback
      // and needs no permission.
      box.value = text;
      box.select();
      fail('Could not reach the clipboard, so the prompt is in the box below. Copy it from there, then paste the answer back.');
    }
  });

  // Not just "Save": the minute limit on the same card has one, and two
  // buttons with the same name on one card is ambiguous to a person and to a
  // test.
  const save = button('Save notes', 'btn', async () => {
    try {
      await savePracticeNotes(family.id, box.value);
      await refresh();
    } catch (error) {
      fail(error.message);
    }
  });

  row.append(copy, save);
  wrap.append(row);
  return wrap;
}

/* --- small helpers ------------------------------------------------------- */

async function act(work) {
  notice.textContent = '';
  try {
    await work();
    await refresh();
  } catch (error) {
    fail(error);
  }
}

function button(text, className, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = text;
  el.addEventListener('click', onClick);
  return el;
}

function detail(name, value) {
  const p = document.createElement('p');
  p.style.margin = '0.5rem 0 0';
  const strong = document.createElement('strong');
  strong.textContent = `${name}: `;
  p.append(strong, document.createTextNode(value));
  return p;
}

function muted(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.margin = '0.35rem 0 0';
  p.textContent = text;
  return p;
}

function label(status) {
  return {
    pending: 'waiting for you',
    approved: 'approved',
    needs_changes: 'sent back',
    suspended: 'paused',
  }[status] ?? status;
}

function fail(error) {
  notice.textContent = error.message;
  notice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
