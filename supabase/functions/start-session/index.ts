import { corsHeaders, json, refuse, logLine } from '../_shared/http.ts';
import { clientAsCaller, clientAsService } from '../_shared/clients.ts';

/**
 * Starts a Pip session.
 *
 * The browser cannot do this itself for two reasons. The ElevenLabs API key
 * would have to be in the page, where anyone could take it and spend the
 * owner's minutes. And every check below — approved, not suspended, within the
 * monthly limit, not already running — would be a check the browser could
 * simply skip.
 *
 * What goes back is a short-lived conversation token and the family's profile
 * formatted for the agent's variables. The voice itself never passes through
 * here: the browser talks to ElevenLabs directly, so no child's voice touches
 * this server.
 */

const MAX_SESSION_SECONDS = 900; // matches the agent's own cap
const STALE_AFTER_SECONDS = MAX_SESSION_SECONDS + 120; // cap, plus slack
const MAX_STARTS_PER_HOUR = 12;

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return refuse('method', 'Use POST.', origin, 405);
  }

  const elevenLabsKey = Deno.env.get('ELEVENLABS_API_KEY');
  const agentId = Deno.env.get('ELEVENLABS_AGENT_ID_EN');
  if (!elevenLabsKey || !agentId) {
    logLine('misconfigured', { has_key: Boolean(elevenLabsKey), has_agent: Boolean(agentId) });
    return refuse('server', 'Pip is not configured yet. Tell Idan.', origin, 500);
  }

  // Two clients, on purpose. The first borrows the caller's own token purely to
  // find out who they are; it can see nothing they could not see themselves.
  // The second holds the service role and does the writing.
  const authHeader = request.headers.get('Authorization') ?? '';
  const asCaller = clientAsCaller(authHeader);
  const asService = clientAsService();

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return refuse('auth', 'Please sign in again.', origin, 401);
  }
  const userId = userData.user.id;

  /* --- the family, and whether it may start anything ---------------------- */

  const { data: family, error: familyError } = await asService
    .from('families')
    .select('id, status, monthly_minute_limit, parent_names, recurring_conflicts, house_rules, extra_care')
    .eq('owner_id', userId)
    .maybeSingle();

  if (familyError) {
    // The message, not just the fact. A bare "lookup failed" is what made a
    // disabled legacy API key look like broken business logic for an hour.
    logLine('family_lookup_failed', { user: userId, message: familyError.message });
    return refuse(
      'server',
      'Something went wrong. Please try again.',
      origin,
      500,
      `${familyError.code ?? ''} ${familyError.message ?? ''} ${familyError.hint ?? ''}`.trim(),
    );
  }
  if (!family) {
    return refuse('no_profile', 'Please fill in your family profile first.', origin);
  }
  if (family.status === 'suspended') {
    return refuse('suspended', 'This account is paused. Talk to Idan.', origin);
  }
  if (family.status !== 'approved') {
    return refuse(
      'not_approved',
      'Your profile is still waiting to be approved, so Pip cannot start yet.',
      origin,
    );
  }

  /* --- minutes ------------------------------------------------------------ */

  const { data: usage } = await asService
    .from('family_usage')
    .select('minutes_used, monthly_minute_limit')
    .eq('family_id', family.id)
    .maybeSingle();

  const used = usage?.minutes_used ?? 0;
  const limit = usage?.monthly_minute_limit ?? family.monthly_minute_limit;
  const remaining = limit - used;

  if (remaining <= 0) {
    return refuse(
      'no_minutes',
      `You have used this month's ${limit} minutes. They reset on the first of the month, or ask Idan for more.`,
      origin,
      429,
    );
  }

  /* --- what the agent is told --------------------------------------------- */

  const body = await request.json().catch(() => ({}));

  const { data: children } = await asService
    .from('children')
    .select('id, first_name, age, personality, conflict_tendency')
    .eq('family_id', family.id)
    .order('sort_order');

  // The per-family practical guidance, if the owner has written it. Read with
  // the service role because the table is admin-only: it is a professional's
  // read on somebody's child and the parent never sees it.
  const { data: practice } = await asService
    .from('practice_notes')
    .select('notes')
    .eq('family_id', family.id)
    .maybeSingle();

  // Every child in the family, not a subset.
  //
  // The screen used to ask the parent to pick who was involved, and that
  // selection was passed through. It is gone, because Pip asks the children
  // who they are itself - which is how it always worked, and which turned out
  // to be load-bearing: the names question is what carries Pip into the
  // calming stage.
  //
  // Sending all of them is also more robust than sending a prediction. The
  // children who turn up are not always the ones a parent tapped thirty
  // seconds earlier, and Pip knowing about a child who stays quiet costs
  // nothing.
  const all = children ?? [];

  const dynamicVariables = {
    // One line per child, in the shape the prompt already expects.
    children: all
      .map((c) => {
        const bits = [`Name: ${c.first_name}, age ${c.age}.`];
        if (c.personality) bits.push(`Personality: ${c.personality}.`);
        if (c.conflict_tendency) bits.push(`Tends to: ${c.conflict_tendency}.`);
        return bits.join(' ');
      })
      .join('\n'),

    parent_names: joinNames(family.parent_names ?? []),
    // Left out entirely when unwritten, so the agent falls back to the general
    // rules held as the variable's default rather than being handed a blank.
    ...(practice?.notes ? { practice_notes: practice.notes } : {}),

    recurring_conflicts: family.recurring_conflicts || 'none noted',
    house_rules: family.house_rules || 'none noted',
    extra_care: family.extra_care || 'nothing noted',
  };

  /* --- preview ------------------------------------------------------------ */

  // Answers "what would Pip be told" without spending anything: no token, no
  // session row, no minutes. Useful to the screen, which can show the parent
  // who Pip will know before they commit, and useful to the tests, which were
  // asking for three real tokens per run just to inspect a string and hit
  // ElevenLabs' rate limit doing it.
  if (body?.preview === true) {
    return json(
      { preview: true, dynamic_variables: dynamicVariables, minutes_remaining: remaining },
      200,
      origin,
    );
  }

  /* --- sweep up anything abandoned ---------------------------------------- */

  // A session whose browser was closed mid-conversation, or crashed, leaves a
  // row with no end. Without this the unique index below would lock the family
  // out of Pip permanently. The full session length is charged, because
  // nobody can say how long it really ran, and guessing low would make
  // abandoning a session the cheapest way to use Pip.
  const staleBefore = new Date(Date.now() - STALE_AFTER_SECONDS * 1000).toISOString();
  const { data: swept } = await asService
    .from('sessions')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: MAX_SESSION_SECONDS,
      duration_source: 'assumed',
    })
    .eq('family_id', family.id)
    .is('ended_at', null)
    .lt('started_at', staleBefore)
    .select('id');

  if (swept?.length) logLine('swept_stale', { family: family.id, count: swept.length });

  /* --- one at a time ------------------------------------------------------- */

  const { data: live } = await asService
    .from('sessions')
    .select('id, started_at')
    .eq('family_id', family.id)
    .is('ended_at', null)
    .maybeSingle();

  if (live) {
    return refuse(
      'already_running',
      'Pip is already in a session for your family. Finish that one first, or close the other tab.',
      origin,
      409,
    );
  }

  /* --- rate limit --------------------------------------------------------- */

  // Not about abuse by these families. It is about a bug on our side, or a
  // child pressing a button repeatedly, quietly spending real money.
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count: recent } = await asService
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('family_id', family.id)
    .gte('started_at', hourAgo);

  if ((recent ?? 0) >= MAX_STARTS_PER_HOUR) {
    return refuse(
      'too_many',
      'That is a lot of sessions in one hour. Give it a little while.',
      origin,
      429,
    );
  }

  /* --- the token ---------------------------------------------------------- */

  const tokenUrl = new URL('https://api.elevenlabs.io/v1/convai/conversation/token');
  tokenUrl.searchParams.set('agent_id', agentId);

  const tokenResponse = await fetch(tokenUrl, { headers: { 'xi-api-key': elevenLabsKey } });
  if (!tokenResponse.ok) {
    // The status, never the body: an error body from a voice API is exactly
    // the kind of thing that ends up containing more than you expected.
    logLine('token_failed', { status: tokenResponse.status, family: family.id });

    // A rate limit is worth saying out loud. It is temporary, it is nobody's
    // fault, and "wait a moment" is the right advice - whereas for a real
    // outage trying again immediately is not. ElevenLabs answers 429 with an
    // empty body, so the status is all there is to go on.
    if (tokenResponse.status === 429) {
      return refuse(
        'voice_busy',
        'Pip is busy at the moment. Please wait a minute and try again.',
        origin,
        429,
      );
    }
    return refuse('voice', 'Pip could not be reached just now. Please try again.', origin, 502);
  }

  const { token, conversation_id: conversationId } = await tokenResponse.json();
  if (!token) {
    logLine('token_missing', { family: family.id });
    return refuse('voice', 'Pip could not be reached just now. Please try again.', origin, 502);
  }

  /* --- record it ---------------------------------------------------------- */

  const { data: session, error: insertError } = await asService
    .from('sessions')
    .insert({ family_id: family.id, agent_id: agentId, conversation_id: conversationId })
    .select('id, started_at')
    .single();

  if (insertError) {
    // Almost certainly the one-live-session index, meaning two taps raced.
    // The token just issued is abandoned rather than used, which costs
    // nothing: no conversation is ever started with it.
    logLine('insert_failed', { family: family.id, code: insertError.code ?? 'unknown' });
    return refuse(
      'already_running',
      'Pip is already starting a session for your family.',
      origin,
      409,
    );
  }

  logLine('session_started', {
    family: family.id,
    session: session.id,
    minutes_remaining: remaining,
  });

  return json(
    {
      token,
      conversation_id: conversationId,
      session_id: session.id,
      dynamic_variables: dynamicVariables,
      max_duration_seconds: MAX_SESSION_SECONDS,
      minutes_remaining: remaining,
    },
    200,
    origin,
  );
});

/** "Mom", "Mom and Abba", "Negev, Nina and Mai". */
function joinNames(names: string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return 'not specified';
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}
