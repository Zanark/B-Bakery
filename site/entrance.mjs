import { tryRingBell } from './bell.mjs';

export function initBakeryEntrance() {
  const entrance = document.getElementById('bakery-entrance');
  const skip = document.getElementById('entrance-skip');
  if (!entrance || !skip) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactView = matchMedia('(max-height: 450px)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const skipReason = reducedMotion.matches ? 'reduced-motion'
    : compactView.matches ? 'short-screen'
      : forcedColors.matches ? 'forced-colors'
        : location.hash ? 'direct-link'
          : document.visibilityState !== 'visible' ? 'background'
            : getComputedStyle(entrance).visibility === 'hidden' ? 'finished' : '';
  if (skipReason) {
    entrance.hidden = true;
    entrance.dataset.state = skipReason;
    entrance.dataset.audio = 'skipped';
    return;
  }

  let finished = false;
  let bell;
  let audioTimer;
  let fallbackTimer;
  const events = new AbortController();
  const startedAt = performance.now();
  entrance.dataset.state = 'opening';

  const finish = reason => {
    if (finished) return;
    finished = true;
    clearTimeout(audioTimer);
    clearTimeout(fallbackTimer);
    events.abort();
    bell?.stop();
    entrance.hidden = true;
    entrance.dataset.state = reason;
    if (entrance.dataset.audio === 'waiting') entrance.dataset.audio = 'skipped';
    if (document.activeElement === skip) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
  };

  const attemptBell = () => {
    const delay = Math.max(0, 380 - (performance.now() - startedAt));
    audioTimer = setTimeout(() => {
      if (finished || document.visibilityState !== 'visible') return;
      try {
        bell = tryRingBell();
        entrance.dataset.audio = bell.status;
      } catch (error) {
        entrance.dataset.audio = 'error';
        console.error('The optional bakery bell could not be played.', error);
      }
    }, delay);
  };

  skip.addEventListener('click', () => finish('skipped'), { signal: events.signal });
  document.addEventListener('keydown', () => finish('skipped'), { capture: true, signal: events.signal });
  document.addEventListener('focusin', event => {
    if (!entrance.contains(event.target)) finish('skipped');
  }, { signal: events.signal });
  window.addEventListener('scroll', () => finish('skipped'), { passive: true, signal: events.signal });
  window.addEventListener('hashchange', () => finish('direct-link'), { signal: events.signal });
  window.addEventListener('pagehide', () => finish('left-page'), { signal: events.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') finish('background');
  }, { signal: events.signal });
  for (const preference of [reducedMotion, compactView, forcedColors]) {
    preference.addEventListener('change', event => {
      if (event.matches) finish('preference-change');
    }, { signal: events.signal });
  }
  entrance.addEventListener('animationend', event => {
    if (event.target === entrance && event.animationName === 'entrance-dismiss') finish('finished');
  }, { signal: events.signal });

  // CSS also dismisses the scene, so unavailable JavaScript/audio cannot trap visitors.
  fallbackTimer = setTimeout(() => finish('finished'), 2100);
  if (document.readyState === 'complete') attemptBell();
  else window.addEventListener('load', attemptBell, { once: true, signal: events.signal });
}
