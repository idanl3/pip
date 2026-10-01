import { corsHeaders, json, refuse, logLine } from '../_shared/http.ts';
import { clientAsCaller, clientAsService } from '../_shared/clients.ts';

/**
 * Closes a session.
 *
 * Called when Pip ends the call itself, when the parent presses stop, when the
 * page is closed, or when the browser notices a long silence. Any of them;
 * whichever gets here first wins and the rest are harmless.
 *
 * The duration is computed here from the row's own start time and is never
 * taken from the request. A browser that could report its own duration could
 * report zero, and the monthly limit would mean nothing. The one thing the
 * caller is trusted with is the fact that it finished.
 *
 * ElevenLabs' webhook is the authority on length and will overwrite this when
 * it arrives. This exists so a family is not left with a session that never
 * closes if it does not.
 */

const MAX_SESSION_SECONDS = 900;

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return refuse('method', 'Use POST.', origin, 405);
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const asCaller = clientAsCaller(authHeader);
  const asService = clientAsService();

  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return refuse('auth', 'Please sign in again.', origin, 401);
  }

  const body = await request.json().catch(() => ({}));
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  const safetyAlert = body?.safety_alert === true;

  if (!sessionId) {
    return refuse('bad_request', 'No session given.', origin, 400);
  }

  // Scoped to the caller's own family. Without this, knowing a session id
  // would be enough to close somebody else's conversation.
  const { data: family, error: familyError } = await asService
    .from('families')
    .select('id')
    .eq('owner_id', userData.user.id)
    .maybeSingle();

  // Check the error separately from the absence of a row. Not doing so cost
  // real time: a broken service-role client made every query fail, and because
  // only `data` was inspected, the function cheerfully reported "no family
  // profile found" for a family that plainly existed. A swallowed error
  // becomes a lie about the data.
  if (familyError) {
    logLine('family_lookup_failed', { message: familyError.message });
    return refuse('server', 'Something went wrong. Please try again.', origin, 500);
  }
  if (!family) {
    return refuse('no_profile', 'No family profile found.', origin);
  }

  const { data: session } = await asService
    .from('sessions')
    .select('id, started_at, ended_at, duration_seconds, duration_source')
    .eq('id', sessionId)
    .eq('family_id', family.id)
    .maybeSingle();

  if (!session) {
    return refuse('not_found', 'That session does not exist.', origin, 404);
  }

  // Already closed. Say yes rather than no: the four ways a session can end
  // can easily fire twice, and a parent pressing stop on an already-finished
  // conversation has done nothing wrong.
  if (session.ended_at) {
    if (safetyAlert) await asService.from('sessions').update({ safety_alert: true }).eq('id', session.id);
    return json(
      { ok: true, already_closed: true, duration_seconds: session.duration_seconds },
      200,
      origin,
    );
  }

  const elapsed = Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000);
  const duration = Math.max(0, Math.min(elapsed, MAX_SESSION_SECONDS));

  const { error: updateError } = await asService
    .from('sessions')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: duration,
      duration_source: 'client',
      ...(safetyAlert ? { safety_alert: true } : {}),
    })
    .eq('id', session.id);

  if (updateError) {
    logLine('end_failed', { session: session.id });
    return refuse('server', 'Could not close the session.', origin, 500);
  }

  logLine('session_ended', {
    session: session.id,
    family: family.id,
    duration,
    safety_alert: safetyAlert,
  });

  return json({ ok: true, duration_seconds: duration }, 200, origin);
});
