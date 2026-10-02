/**
 * The microphone: asking for it, and explaining a refusal.
 *
 * This lives on its own because two very different screens need it. The kids'
 * screen needs it at the worst possible moment - a fight is happening - and the
 * parents' portal needs it at the best one, which is the point.
 *
 * A permission the operating system has withheld cannot be granted by a web
 * page, and nothing here pretends otherwise. What it can do is find out early,
 * say precisely what is wrong, and let a parent re-check with one tap instead
 * of starting over.
 */

// Set once the microphone has actually been granted on this device, so the
// launch screen can stop suggesting a check that has already passed.
const GRANTED_KEY = 'pip.microphone.granted.v1';

export function wasEverGranted() {
  try {
    return localStorage.getItem(GRANTED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Records a success without asking again.
 *
 * The portal's check calls getUserMedia itself, as the first thing its tap
 * does, so it cannot route through requestMicrophone without asking twice.
 */
export function markGranted() {
  rememberGranted();
}

function rememberGranted() {
  try {
    localStorage.setItem(GRANTED_KEY, new Date().toISOString());
  } catch {
    // Private browsing. The check still works, it just asks again next time.
  }
}

/**
 * Asks for the microphone, then hands the device straight back.
 *
 * Only the permission is wanted. The voice SDK opens its own capture a moment
 * later, and a granted microphone stays granted for the page. Holding the
 * track open was tried first and is worse: some Android devices will not give
 * the same microphone to a second capture.
 *
 * Must be called from inside a tap, with nothing slow in front of it. The
 * browser only grants a microphone during a user gesture, and a round trip to
 * a server is enough to lose one.
 */
export async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('no microphone API'), { name: 'NotSupportedError' });
  }

  const started = performance.now();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    error.pipElapsedMs = Math.round(performance.now() - started);
    throw error;
  }

  for (const track of stream.getTracks()) track.stop();
  rememberGranted();
}

/**
 * What the browser has already decided about this site.
 *
 * 'denied' means the site itself is blocked, which is the one state a parent
 * can fix from the address bar. Anything else means a refusal came from
 * further out. Not every browser answers this query, so 'unknown' is a real
 * third answer rather than a failure.
 */
export async function siteState() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/**
 * How many microphones the browser admits to having.
 *
 * Zero is meaningful. A device-wide microphone switch takes the input away
 * from the browser entirely rather than refusing a site, and this is the only
 * trace of that a web page can read.
 */
export async function audioInputCount() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput').length;
  } catch {
    return '?';
  }
}

export const MICROPHONE_ERRORS = [
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'SecurityError',
  'OverconstrainedError',
  'AbortError',
  'NotSupportedError',
];

export function isMicrophoneError(error) {
  return MICROPHONE_ERRORS.includes(error?.name);
}

/**
 * A refusal, as a heading and a list of steps.
 *
 * Steps rather than a paragraph, because this is read on a phone by somebody
 * who is not a computer person and may be in the middle of a fight. A
 * paragraph telling you to visit three settings screens is a paragraph nobody
 * finishes.
 *
 * NotAllowedError is several unrelated problems wearing one name, and the fix
 * is somewhere different for each. Sending a parent to the address bar when
 * the block is at the operating system level sends them looking for a setting
 * that is not there.
 */
export async function explainRefusal(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError': {
      const state = await siteState();
      const inputs = await audioInputCount();

      if (state === 'denied') {
        return {
          heading: 'Your browser has blocked the microphone for Pip',
          steps: [
            'Tap the icon just to the left of the web address at the top of the screen.',
            'Tap Permissions.',
            'Set Microphone to Allow.',
            'Come back here and tap Check again.',
          ],
        };
      }

      if (inputs === 0) {
        return {
          heading: 'Your phone has switched its microphone off',
          steps: [
            'Swipe down from the top of the screen to open the quick settings.',
            'Look for a Microphone or Mic access tile and turn it back on.',
            'If it is not there, open Settings, then Privacy, then Microphone access.',
            'Come back here and tap Check again.',
          ],
        };
      }

      return {
        heading: 'Your phone is not letting the browser use the microphone',
        steps: [
          "Open your phone's Settings, then Apps, then Chrome.",
          'Tap Permissions, then Microphone, and choose Allow only while using the app.',
          "If that was already allowed, open Chrome's own menu, then Settings, " +
            'then Site settings, then Microphone, and make sure it is switched on.',
          'Come back here and tap Check again.',
        ],
      };
    }

    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        heading: 'No microphone was found on this device',
        steps: [
          'If you are on a computer, plug in or switch on a microphone.',
          'If you are on a phone, try closing and reopening the browser.',
          'Then tap Check again.',
        ],
      };

    case 'NotReadableError':
    case 'AbortError':
      return {
        heading: 'Something else is using the microphone',
        steps: [
          'Close any call, voice note, or recording app that is open.',
          'Then tap Check again.',
        ],
      };

    case 'NotSupportedError':
      return {
        heading: 'This browser cannot reach the microphone',
        steps: ['Open Pip in Chrome or Safari instead.'],
      };

    default:
      return {
        heading: 'The microphone could not be opened',
        steps: ['Tap Check again. If it keeps happening, send Idan the grey line below.'],
      };
  }
}

/** The quiet line underneath, so a report can say what actually happened. */
export async function refusalDetail(error) {
  const took = error?.pipElapsedMs === undefined ? '' : ` · ${error.pipElapsedMs}ms`;
  return (
    `${error?.name ?? 'unknown'} · site: ${await siteState()} ` +
    `· inputs: ${await audioInputCount()}${took}`
  );
}

/** Renders a heading and steps into an element. Used on both screens. */
export function renderRefusal(host, { heading, steps }, detail) {
  host.replaceChildren();

  const title = document.createElement('p');
  title.className = 'mic__heading';
  title.textContent = heading;

  const list = document.createElement('ol');
  list.className = 'mic__steps';
  for (const step of steps) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }

  host.append(title, list);

  if (detail) {
    const line = document.createElement('p');
    line.className = 'mic__detail';
    line.textContent = detail;
    host.append(line);
  }
}
