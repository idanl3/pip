/**
 * Suggestions offered to parents during onboarding.
 *
 * Parents find describing their own child surprisingly hard - "she's just
 * normal" is the usual first answer - so the form offers these to tap, and
 * every one of them is optional. Anything typed by hand carries equal weight.
 *
 * Four rules govern what belongs in these lists. Read them before adding to
 * them.
 *
 * 1. Describe a tendency, never pin an identity. Pip's own instructions forbid
 *    labelling a child, so "finds it hard to back down" belongs here and
 *    "stubborn" does not. The difference is not politeness; a label invites
 *    Pip to treat the label as the truth about the child.
 *
 * 2. Each entry must change what Pip does. "Takes a long time to calm down"
 *    changes Pip's pacing. "Funny" changes nothing. Charm is not a reason to
 *    include something.
 *
 * 3. Plain parent language, never clinical. No diagnosis and nothing adjacent
 *    to one. Pip is explicitly forbidden from suggesting a child has a
 *    condition, and the profile should not smuggle one in.
 *
 * 4. Difficult traits get fair, warm framing. A parent should be able to tick
 *    the honest answer without feeling they have told on their child.
 *
 * Keep every entry plain ASCII.
 *
 * These strings are stored and then sent to the voice agent, and somewhere in
 * that chain UTF-8 gets decoded as Latin-1. An em dash left the database as
 * U+2014 and arrived at ElevenLabs as three characters of mojibake, so Pip was
 * reading "Sensitive a- feels things deeply" inside a child's profile. The
 * owner's own prompt was plain ASCII throughout and never had the problem.
 *
 * Between them the lists are meant to span real children: loud and quiet, fast
 * and slow to anger, those who fight and those who fold, those who argue the
 * rules and those who cannot find words at all.
 */

/** What this child is generally like. */
export const PERSONALITY_SUGGESTIONS = [
  // How they are with people
  'Shy with new people, slow to warm up',
  'Chatty - thinks out loud',
  'Quiet - keeps things inside',
  'Takes charge and organises everyone else',
  'Happiest with one person at a time',

  // How strongly and how fast they feel things
  'Sensitive - feels things deeply',
  'Big feelings that arrive fast and pass fast',
  'Slow to get angry, but holds onto it',
  'Easily overwhelmed by noise and commotion',
  'Steady - hard to rattle',

  // What they care about
  'Strong sense of fairness, notices anything uneven',
  'Wants grown-ups to be pleased with them',
  'Likes to win',
  'Likes things done properly and gets frustrated when they are not',

  // How they handle being wrong, and the unexpected
  'Proud - finds being wrong hard',
  'Cautious, likes to know what is coming',
  'Takes words literally, exactly as they were said',
  'Independent - would rather sort things out alone',
  'Affectionate, makes up through cuddles rather than words',
];

/** What this child tends to do once a conflict has started. */
export const CONFLICT_SUGGESTIONS = [
  // Folding
  'Gives in quickly to keep the peace',
  'Says sorry fast, without really meaning it',
  'Says they do not care when they clearly do',

  // Fighting
  'Digs in and will not budge',
  'Gets loud - shouts, slams doors',
  'Grabs or pushes',
  'Talks over the other one',
  'Insists the other one started it',

  // Withdrawing
  'Goes quiet and withdraws',
  'Walks away and needs time alone first',
  'Freezes and cannot find the words',

  // Escalating
  'Cries and finds it hard to stop',
  'Brings up things that happened weeks ago',
  'Hears it as "you do not like me"',

  // Turning outward
  'Comes to find a grown-up straight away',
  'Wants an adult to decide who is right',

  // Problem-solving, for better and worse
  'Argues the rules in detail',
  'Comes up with inventive compromises',
  'Tries to fix it immediately, before anyone has calmed down',
  'Makes a joke to defuse it',
];

/**
 * How the children address their parents. Offered because the field confuses
 * people - they reach for their own first names, and Pip needs the word the
 * children actually use when it turns to the parent at the end.
 */
export const PARENT_NAME_SUGGESTIONS = ['Mum', 'Mom', 'Dad', 'Mama', 'Papa', 'Ima', 'Abba'];

/** Things families argue about again and again. */
export const RECURRING_CONFLICT_SUGGESTIONS = [
  "Competing for a parent's attention",
  'Screen time - whose turn, how long',
  'Rules of a game, and who is cheating',
  "Sharing toys, or one taking the other's things",
  'Who sits where, who goes first',
  'Tidying up, and who made the mess',
  'Bedtime',
  'One copying or following the other',
  'Teasing that goes too far',
  'Space - one wanting to play alone',
];

/** House rules the children already know, offered as a starting point. */
export const HOUSE_RULE_SUGGESTIONS = [
  'No hitting',
  'A timer for screen time',
  'Everyone helps tidy up',
  'Ask before taking something that is not yours',
  'No name-calling',
  'Knock before going into a bedroom',
  'We do not shout at each other',
];
