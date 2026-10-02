import promptTemplate from '../../agent/pip-prompt.template.md?raw';

/**
 * Builds the prompt the owner pastes into an AI to get a family's practice
 * notes written.
 *
 * Why this exists at all: the section of Pip's instructions called "What this
 * profile means in practice" is what made Pip adapt properly to a
 * five-year-old. It turns facts into instructions —
 *
 *   fact      Mai, age 5. Shy. Gets very upset when overwhelmed.
 *   practice  "Mai is young and shy. Speak to her in very short, simple
 *              sentences, offer choices instead of open questions, and never
 *              let the older two speak over her."
 *
 * — and that translation is a professional judgement. It is not the parent's
 * to make, and it cannot be assembled from a table: "never let the older two
 * speak over her" came from combining her age with her siblings' ages with the
 * fact that one of them talks over people. It needs something that has read
 * the whole method and the whole profile and can reason across them.
 *
 * For now that something is the owner, with an AI drafting. This assembles
 * everything that AI needs in one block: the method, the profile, and examples
 * of the standard to match.
 */

/**
 * The examples, which are the owner's own and are genuinely good.
 *
 * The names are changed. The value here is entirely in the reasoning and the
 * tone, not in whose children they describe, and these get pasted into an AI
 * once per family — so carrying one family's children into every other
 * family's generation would be a leak for no benefit.
 */
const EXAMPLES = [
  "Ari may agree too fast just to end the argument. Gently check that solutions really work for him, and make sure his own feelings get space, not only everyone else's.",
  'Noa will notice anything that seems unfair, including how you treat each child. Keep turns and attention visibly even. Invite her creative ideas during problem-solving, but make sure her solutions work for the others too, not just cleverly for her.',
  "Tal is young and shy. Speak to her in very short, simple sentences, offer choices instead of open questions, and never let the older two speak over her. If she gets overwhelmed, stop and calm first, and invite Mum or Dad to help if she doesn't settle quickly.",
  'When the conflict is about parents\' attention, don\'t promise anything on the parents\' behalf. Name the feeling ("It sounds like you really wanted time with Dad") and mention it in the recap so the parent can follow up.',
];

/** The family's facts, in the shape the agent receives them. */
export function describeFamily(family, children) {
  const lines = ['Children:'];

  for (const child of children) {
    const bits = [`Name: ${child.first_name}, age ${child.age}.`];
    if (child.personality) bits.push(`Personality: ${child.personality}.`);
    if (child.conflict_tendency) bits.push(`Tends to: ${child.conflict_tendency}.`);
    lines.push(bits.join(' '));
  }

  lines.push(
    '',
    `What the children call their parents: ${(family.parent_names ?? []).join(' and ') || 'not given'}`,
    `Recurring conflicts: ${family.recurring_conflicts || 'none noted'}`,
    `House rules the children know: ${family.house_rules || 'none noted'}`,
    `Anything to handle with extra care: ${family.extra_care || 'nothing noted'}`,
  );

  return lines.join('\n');
}

export function buildGeneratorPrompt(family, children) {
  return `You are a child development specialist and a parent coach. You are
writing one short section of the instructions given to Pip, a voice mediator
that helps brothers and sisters work through a fight. Pip's complete
instructions are included below, so that you can see exactly what it already
knows and already does.

Your job is to write the section called "What this profile means in practice"
for the family whose profile follows. That section turns the facts of a profile
into things Pip should actually do differently with these particular children.
It is the difference between Pip knowing a child is five and Pip knowing to ask
her a yes-or-no question instead of an open one.

How to write it:

- Address Pip directly, as "you".
- Name each child.
- Say what Pip should DO, not what the child is like. The profile above it
  already says what they are like; repeating that is wasted.
- Think across the family, not one child at a time. The most useful lines come
  from combining facts: a much younger child next to a sibling who talks over
  people needs her turn protected, and neither fact says that alone.
- One line per child, then any family-level lines that matter.
- Four to six lines in total. This sits inside a long prompt and has to earn
  its space.
- Keep each line to about 40 words and never more than 50. The examples below
  run from 30 to 48 words. If a line is longer than that, you are explaining
  rather than instructing.
- Do not restate the profile. It sits directly above this section and Pip has
  already read it. One short clause to anchor who the line is about is enough,
  as in "Mai is young and shy"; everything after it should be something to do.
- Two or three instructions per child, the ones that matter most. If you have a
  fourth, drop the weakest rather than making the line longer.
- Name the other children and the parents where it sharpens an instruction.
  "when Nina talks over her" is more use than "when another child talks over
  her", because Pip knows who Nina is.
- Plain ASCII only. No em dashes, no curly quotes, no accented characters.
- No diagnosis, no labels, no clinical language. Describe what to do, never
  what the child is.
- No bullets, no headings, no preamble. Just the lines.

Here are four lines written for a different family, which are the standard to
match. Follow the reasoning and the tone; the content is not relevant to this
family:

${EXAMPLES.map((line) => `  ${line}`).join('\n')}

=== Pip's complete instructions ===

${promptTemplate}

=== The family you are writing for ===

${describeFamily(family, children)}

=== End ===

Return only the lines, with nothing before or after them.`;
}
