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

/** The signed-in parent's family, or null if they have not made one yet. */
export async function loadFamily() {
  const { data, error } = await supabase
    .from('families')
    .select('*')
    .limit(1)
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
 * Children are replaced rather than merged. The alternative is tracking which
 * rows were edited, removed or added across a form where a parent can delete
 * the middle child and reorder the rest, and getting that subtly wrong would
 * mean a child's details attached to the wrong name. At three children per
 * family, replacing is both simpler and safer.
 *
 * This is not a transaction. If the children insert fails after the family row
 * is written, the profile is left with the new answers and no children, and
 * the form will say so rather than pretend it saved. A proper transaction
 * needs a database function, which is worth doing if this ever grows.
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

  const { error: clearError } = await supabase
    .from('children')
    .delete()
    .eq('family_id', family.id);
  if (clearError) throw clearError;

  const rows = children.map((child, index) => ({
    family_id: family.id,
    first_name: child.first_name,
    age: child.age,
    personality: child.personality || null,
    conflict_tendency: child.conflict_tendency || null,
    sort_order: index,
  }));

  if (rows.length) {
    const { error } = await supabase.from('children').insert(rows);
    if (error) throw error;
  }

  return family;
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
