import { supabase } from './supabase.js';

/**
 * Reading and writing the family profile.
 *
 * Every call here goes through the Data API with the signed-in parent's own
 * token, so row-level security decides what is visible. None of these
 * functions filter by owner: they do not need to, and a filter written here
 * would imply the database was relying on it. A parent asking for every family
 * gets their own and nothing else.
 *
 * One consequence worth remembering while debugging: a query that comes back
 * empty, rather than failing, usually means a policy declined it. That is the
 * design working.
 */

/**
 * The signed-in parent's own family, or null if they have not made one yet.
 *
 * The `owner_id` filter is load-bearing, which is the opposite of what the
 * note above says and is why that note is now wrong for this one function.
 *
 * Leaning on row-level security alone works for a parent, who can see exactly
 * one family. It fails for an admin, whose policy lets them read *every*
 * family — so `select('*').limit(1)` handed back an arbitrary one. The owner
 * runs the pilot and is also a family in it, so their own home page showed
 * another family's children, and saving the profile would have written to that
 * family's row.
 *
 * Found by a test that passed alone and failed in a suite, because only then
 * was there more than one family in the table to pick the wrong one from.
 */
export async function loadFamily() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return null;

  const { data, error } = await supabase
    .from('families')
    .select('*')
    .eq('owner_id', userData.user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function loadChildren(familyId) {
  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('family_id', familyId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Saves the whole profile: the family row and its children together.
 *
 * Children are reconciled by id - updated, inserted, or removed - rather than
 * deleted and rewritten. Replacing them was simpler and was wrong for two
 * reasons. A child's row id changed on every save, so nothing could ever link
 * to one child; and a failure between the delete and the insert left a family
 * with no children at all, which is the one state that cannot be recovered
 * from the form.
 *
 * This is still not a transaction. If one child's update fails the earlier
 * ones have already been written, and the form says so rather than pretending
 * it saved. Partial now means some children updated, which is recoverable by
 * pressing save again. A proper transaction needs a database function, which
 * is worth doing if this ever grows.
 */
export async function saveProfile(profile, children) {
  const existing = await loadFamily();

  let family;
  if (existing) {
    const { data, error } = await supabase
      .from('families')
      .update(profile)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    family = data;
  } else {
    const { data, error } = await supabase
      .from('families')
      .insert(profile)
      .select()
      .single();
    if (error) throw error;
    family = data;
  }

  const before = await loadChildren(family.id);
  const kept = new Set();

  for (const [index, child] of children.entries()) {
    const fields = {
      first_name: child.first_name,
      age: child.age,
      personality: child.personality || null,
      conflict_tendency: child.conflict_tendency || null,
      sort_order: index,
    };

    if (child.id) {
      kept.add(child.id);
      const { error } = await supabase
        .from('children')
        .update(fields)
        .eq('id', child.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('children')
        .insert({ family_id: family.id, ...fields });
      if (error) throw error;
    }
  }

  const gone = before.filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (gone.length) {
    const { error } = await supabase.from('children').delete().in('id', gone);
    if (error) throw error;
  }

  return family;
}


/** One child, for the form that fixes a single child's answers. */
export async function loadChild(childId) {
  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('id', childId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Updates one child and nothing else.
 *
 * Correcting an age used to mean reopening the whole form and writing every
 * answer about every child back over itself. That is a lot of writing to fix
 * one number, and it put all three children's descriptions on screen to
 * change one child's.
 *
 * The name and age are always written, because the form shows them and a
 * parent can see what they are changing. The two description fields are only
 * written when something was actually typed: they are shown empty on purpose,
 * so an empty one means "leave this as it is" rather than "erase it". Writing
 * them unconditionally would wipe everything Pip knows about a child the first
 * time somebody opened the page to correct an age.
 *
 * A database trigger sends the family back for review when any child row
 * changes, so this needs no help to do that - and should not try, because the
 * families guard trigger rejects a parent setting their own status.
 */
export async function saveChild(childId, fields) {
  const patch = { first_name: fields.first_name, age: fields.age };
  if (fields.personality?.trim()) patch.personality = fields.personality.trim();
  if (fields.conflict_tendency?.trim()) {
    patch.conflict_tendency = fields.conflict_tendency.trim();
  }

  const { error } = await supabase.from('children').update(patch).eq('id', childId);
  if (error) throw error;
}

/**
 * Updates the household answers and nothing else.
 *
 * Separate from saveProfile because the form that edits these no longer has
 * the children on it, and saveProfile reconciles children against what it was
 * given - handed an empty list, it would delete every child in the family.
 *
 * Only the fields actually passed are written. The boxes are shown empty, so a
 * parent rewrites an answer without reading the old one, and an empty box has
 * to mean "leave this alone" rather than "erase it": otherwise coming here to
 * change one answer would quietly wipe the other three.
 */
export async function saveHousehold(fields) {
  const family = await loadFamily();
  if (!family) throw new Error('No family profile found.');

  const patch = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      return String(value).trim() !== '';
    }),
  );

  if (!Object.keys(patch).length) return family;

  const { data, error } = await supabase
    .from('families')
    .update(patch)
    .eq('id', family.id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Adds one child. The family goes back for review by database trigger. */
export async function addChild(familyId, fields) {
  const existing = await loadChildren(familyId);
  const { data, error } = await supabase
    .from('children')
    .insert({
      family_id: familyId,
      first_name: fields.first_name,
      age: fields.age,
      personality: fields.personality || null,
      conflict_tendency: fields.conflict_tendency || null,
      sort_order: existing.length,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Removes one child.
 *
 * Refuses to remove the last one. A family with no children cannot start a
 * session and cannot be mediated, and the only way back would be through the
 * form that no longer collects them.
 */
export async function removeChild(familyId, childId) {
  const existing = await loadChildren(familyId);
  if (existing.length <= 1) {
    throw new Error('A family needs at least one child.');
  }

  const { error } = await supabase.from('children').delete().eq('id', childId);
  if (error) throw error;
}

/** Human wording for a family's status, for the parent's own screen. */
export function describeStatus(status) {
  switch (status) {
    case 'pending':
      return {
        tone: 'waiting',
        title: 'Waiting to be approved',
        body:
          'Idan reads every profile before a family starts using Pip. You will ' +
          'be able to start a session once that is done.',
      };
    case 'approved':
      return {
        tone: 'info',
        title: 'Ready to go',
        body: 'You can start a session whenever you need one.',
      };
    case 'needs_changes':
      return {
        tone: 'waiting',
        title: 'A small change is needed',
        body: 'Idan has left a note below. Update your answers and it will go back for another look.',
      };
    case 'suspended':
      return {
        tone: 'error',
        title: 'Paused',
        body: 'This account is paused. Talk to Idan if that is unexpected.',
      };
    default:
      return { tone: 'info', title: status, body: '' };
  }
}
