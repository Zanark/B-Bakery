export const BELL_DURATION_SECONDS = 1.3;

const MASTER_GAIN = 0.12;
const STOP_FADE_SECONDS = 0.03;
const partials = [
  { ratio: 1, weight: 0.55, duration: BELL_DURATION_SECONDS },
  { ratio: 2.01, weight: 0.25, duration: 1.02 },
  { ratio: 2.76, weight: 0.13, duration: 0.78 },
  { ratio: 4.08, weight: 0.07, duration: 0.56 },
];

/**
 * Schedule an original, inharmonic bell; offline contexts may be suspended.
 * @param {AudioContext | OfflineAudioContext} context
 * @returns {{ endTime: number, output: GainNode }}
 */
export function createBellVoice(context) {
  const now = context.currentTime;
  const startTime = now + 0.008;
  const endTime = now + BELL_DURATION_SECONDS;
  const output = context.createGain();
  // Unit sine peaks and weights summing to one bound the digital peak to 0.12.
  output.gain.setValueAtTime(MASTER_GAIN, now);

  for (const { ratio, weight, duration } of partials) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const partialEnd = now + duration;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(740 * ratio, startTime);
    envelope.gain.setValueAtTime(0, startTime);
    envelope.gain.linearRampToValueAtTime(weight, startTime + 0.018);
    envelope.gain.exponentialRampToValueAtTime(weight * 0.003, partialEnd - 0.025);
    envelope.gain.linearRampToValueAtTime(0, partialEnd);
    oscillator.connect(envelope);
    envelope.connect(output);
    oscillator.start(startTime);
    oscillator.stop(partialEnd);
  }

  output.connect(context.destination);
  return { endTime, output };
}

function reportCleanupError(error) {
  console.error('[Bakery bell] Cleanup failed.', error);
}

function cleanUp(action) {
  try {
    action();
  } catch (error) {
    reportCleanupError(error);
  }
}

function closeContext(context) {
  cleanUp(() => {
    if (context.state !== 'closed') context.close().catch(reportCleanupError);
  });
}

/**
 * Respect the existing playback policy; never unlock or defer blocked audio.
 * @param {{
 *   AudioContextClass?: typeof AudioContext | null,
 *   setTimeoutFn?: typeof setTimeout,
 *   clearTimeoutFn?: typeof clearTimeout
 * }} options
 * @returns {{ status: 'started' | 'blocked' | 'unavailable', stop: () => void }}
 */
export function tryRingBell(options = {}) {
  const {
    AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
  } = options;
  const silent = (status) => ({ status, stop() {} });
  if (AudioContextClass == null) return silent('unavailable');

  let context;
  try {
    context = new AudioContextClass();
  } catch (error) {
    if (typeof DOMException !== 'undefined' && error instanceof DOMException &&
        ['NotAllowedError', 'SecurityError', 'NotSupportedError'].includes(error.name)) {
      console.warn('[Bakery bell] Audio unavailable under the current platform policy.', error);
      return silent(error.name === 'NotSupportedError' ? 'unavailable' : 'blocked');
    }
    throw error;
  }

  if (context.state !== 'running') {
    closeContext(context);
    return silent('blocked');
  }

  let output;
  let timer = null;
  let stopping = false;
  let released = false;

  function clearTimer() {
    if (timer !== null) {
      const pending = timer;
      timer = null;
      clearTimeoutFn(pending);
    }
  }

  function finish() {
    if (released) return;
    released = true;
    stopping = true;
    cleanUp(clearTimer);
    cleanUp(() => context.removeEventListener('statechange', onStateChange));
    // Disconnect even if close() fails, so suspension cannot leave audible work.
    if (output) cleanUp(() => output.disconnect());
    output = undefined;
    closeContext(context);
  }

  function onStateChange() {
    if (context.state !== 'running') finish();
  }

  function stop() {
    if (stopping) return;
    stopping = true;
    cleanUp(clearTimer);
    if (context.state !== 'running') {
      finish();
      return;
    }
    try {
      const now = context.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(MASTER_GAIN, now);
      output.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
      timer = setTimeoutFn(finish, STOP_FADE_SECONDS * 1000 + 10);
    } catch (error) {
      reportCleanupError(error);
      finish();
    }
  }

  try {
    const voice = createBellVoice(context);
    output = voice.output;
    context.addEventListener('statechange', onStateChange);
    if (context.state !== 'running') {
      finish();
      return silent('blocked');
    }
    timer = setTimeoutFn(finish, Math.ceil(Math.max(0, voice.endTime - context.currentTime) * 1000) + 20);
  } catch (error) {
    finish();
    throw error;
  }

  return { status: 'started', stop };
}
