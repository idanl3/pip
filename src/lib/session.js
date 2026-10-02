import { Conversation } from '@elevenlabs/client';
import { supabase } from './supabase.js';

/**
 * Running a session, and — the harder half — reliably ending one.
 *
 * In the owner's own testing Pip said goodbye and then kept listening to the
 * family's evening. That is both a privacy problem and a bill. So a session
 * here can end five independent ways, any one of which is enough:
 *
 *   1. Pip's own end_call tool, now that it is enabled on the agent.
 *   2. The agent's maximum duration, 15 minutes, enforced by ElevenLabs.
 *   3. The parent pressing end.
 *   4. This page noticing a long silence, or the tab being hidden or closed.
 *   5. A local timer matching the agent's cap, in case the platform's own
 *      does not fire.
 *
 * They overlap on purpose. Whichever happens first wins and the others become
 * harmless no-ops, because `end-session` is idempotent. Overlapping shutdowns
 * are a much better failure than a session nobody closes.
 */

const SILENCE_MS = 45_000;
const HIDDEN_MS = 60_000;
const LEVEL_POLL_MS = 60;
const SILENCE_THRESHOLD = 0.02;

/**
 * Asks the server to start a session.
 *
 * Returns the token, the formatted profile for the agent, and how many
 * minutes are left. Refusals come back as an Error carrying `.code`, so the
 * page can tell "waiting for approval" from "out of minutes" and say
 * something useful.
 */
export async function requestSession({ childIds = [], includeOther = false } = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw Object.assign(new Error('Please sign in again.'), { code: 'auth' });

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/start-session`, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ child_ids: childIds, include_other: includeOther }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Object.assign(new Error(payload.message ?? 'Pip could not start.'), {
      code: payload.error ?? 'unknown',
    });
  }
  return payload;
}

/** Tells the server a session is over. Safe to call more than once. */
export async function releaseSession(sessionId, { safetyAlert = false } = {}) {
  if (!sessionId) return;
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return;

  await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/end-session`, {
    method: 'POST',
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ session_id: sessionId, safety_alert: safetyAlert }),
    // Survives the page being closed, which is the whole reason this call
    // exists on the unload path.
    keepalive: true,
  }).catch(() => {
    /* Nothing useful to do here. The server sweeps up stale sessions. */
  });
}

/**
 * A live conversation, with all the ending machinery attached.
 */
export class PipSession {
  /**
   * @param {object} options
   * @param {(state: string) => void} options.onState   waiting|listening|speaking|thinking|ended
   * @param {(levels: {input:number,output:number}) => void} options.onLevels
   * @param {() => void} options.onSafetyAlert
   * @param {(reason: string) => void} options.onEnded
   * @param {(message: string) => void} options.onError
   * @param {(turn: {role: string, text: string}) => void} [options.onTranscript]
   */
  constructor(options) {
    this.options = options;
    this.conversation = null;
    this.sessionId = null;
    this.safetyAlert = false;
    this.finished = false;
    this.lastSound = Date.now();
    this.hiddenSince = null;
    this.timers = [];

    this.onVisibility = this.onVisibility.bind(this);
    this.onPageHide = this.onPageHide.bind(this);
  }

  async start({ childIds, includeOther }) {
    const details = await requestSession({ childIds, includeOther });
    this.sessionId = details.session_id;

    this.conversation = await Conversation.startSession({
      conversationToken: details.token,
      connectionType: 'webrtc',

      // The family profile. This is the moment the templated prompt stops
      // being a template.
      dynamicVariables: details.dynamic_variables,

      clientTools: {
        /**
         * Pip calls this when its safety section triggers.
         *
         * Nothing about what the child said goes anywhere: the page shows the
         * parent an alert, and the only thing that reaches the server is a
         * boolean on the session row. The substance is for the parent and the
         * child, and it is not ours.
         *
         * The agent side of this tool is declared in phase 7; registering it
         * here first is harmless, and means it works the moment it is.
         */
        alert_parent: () => {
          this.safetyAlert = true;
          this.options.onSafetyAlert?.();
          return 'The parent has been alerted on screen.';
        },
      },

      onConnect: () => {
        this.lastSound = Date.now();
        this.options.onState?.('listening');
      },

      onModeChange: ({ mode }) => {
        if (this.finished) return;
        // The SDK reports the agent's mode. "speaking" and "listening" are the
        // two the children need to be able to tell apart.
        if (mode === 'speaking') this.options.onState?.('speaking');
        else if (mode === 'listening') this.options.onState?.('listening');
        else this.options.onState?.('thinking');
      },

      onDisconnect: () => {
        // Covers Pip's own end_call and the platform's duration cap.
        this.finish('pip');
      },

      onError: (message) => {
        this.options.onError?.(typeof message === 'string' ? message : 'Something went wrong.');
        this.finish('error');
      },

      onMessage: ({ message, source }) => {
        // Kept in memory only, for the recap the browser builds in phase 6.
        // Never uploaded, never logged.
        if (message) this.options.onTranscript?.({ role: source, text: message });
      },
    });

    this.watchLevels();
    this.watchClock(details.max_duration_seconds ?? 900);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);

    return details;
  }

  /** Polls the SDK for audio levels: this is what makes the blob honest. */
  watchLevels() {
    const timer = setInterval(() => {
      if (this.finished || !this.conversation) return;
      let input = 0;
      let output = 0;
      try {
        input = this.conversation.getInputVolume?.() ?? 0;
        output = this.conversation.getOutputVolume?.() ?? 0;
      } catch {
        // The SDK throws if asked after teardown. Not worth reporting.
        return;
      }
      this.options.onLevels?.({ input, output });

      if (input > SILENCE_THRESHOLD || output > SILENCE_THRESHOLD) {
        this.lastSound = Date.now();
      } else if (Date.now() - this.lastSound > SILENCE_MS) {
        // Nobody has made a sound for 45 seconds. Either everyone wandered
        // off, or the conversation finished and nothing told us.
        this.finish('silence');
      }
    }, LEVEL_POLL_MS);
    this.timers.push(timer);
  }

  watchClock(maxSeconds) {
    // A local copy of the agent's own cap. If the platform's timer ever fails,
    // this one still stops the bill.
    this.timers.push(setTimeout(() => this.finish('too_long'), (maxSeconds + 10) * 1000));
  }

  onVisibility() {
    if (document.visibilityState === 'hidden') {
      this.hiddenSince = Date.now();
      this.timers.push(
        setTimeout(() => {
          if (document.visibilityState === 'hidden' && this.hiddenSince) this.finish('hidden');
        }, HIDDEN_MS),
      );
    } else {
      this.hiddenSince = null;
    }
  }

  onPageHide() {
    // The tab is going away. There is no time for anything but a keepalive
    // request, which is exactly what releaseSession sends.
    if (!this.finished) {
      this.finished = true;
      releaseSession(this.sessionId, { safetyAlert: this.safetyAlert });
    }
  }

  /** The parent pressing end. */
  async stop() {
    await this.finish('parent');
  }

  async finish(reason) {
    if (this.finished) return;
    this.finished = true;

    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];

    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);

    this.options.onState?.('ended');

    try {
      await this.conversation?.endSession();
    } catch {
      // Already gone, which is fine: the point was to be sure.
    }

    await releaseSession(this.sessionId, { safetyAlert: this.safetyAlert });
    this.options.onEnded?.(reason);
  }
}
