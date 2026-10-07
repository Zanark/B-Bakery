export function initBakeryEntrance({ tryRingBell } = {}) {
  const entrance = document.getElementById('bakery-entrance');
  const enter = document.getElementById('entrance-enter');
  const skip = document.getElementById('entrance-skip');
  if (!entrance || !enter || !skip) return;
  if (typeof tryRingBell !== 'function') {
    throw new TypeError('The bakery entrance requires a bell playback function.');
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactView = matchMedia('(max-height: 450px)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
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
  let fallbackTimer;
  const events = new AbortController();
  entrance.dataset.state = 'waiting';

  const finish = reason => {
    if (finished) return;
    finished = true;
    clearTimeout(fallbackTimer);
    events.abort();
    bell?.stop();
    entrance.hidden = true;
    entrance.dataset.state = reason;
    if (entrance.dataset.audio === 'waiting') entrance.dataset.audio = 'skipped';
    if (document.activeElement === skip || document.activeElement === enter) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
  };

  const beginEntrance = event => {
    event?.preventDefault();
    if (finished || entrance.classList.contains('is-entering')) return;
    entrance.classList.add('is-entering');
    entrance.dataset.state = 'opening';
    try {
      bell = tryRingBell();
      entrance.dataset.audio = bell.status;
    } catch (error) {
      entrance.dataset.audio = 'error';
      console.error('The optional bakery bell could not be played.', error);
    }
    fallbackTimer = setTimeout(() => finish('finished'), 2100);
  };

  enter.addEventListener('click', beginEntrance, { signal: events.signal });
  skip.addEventListener('click', () => finish('skipped'), { signal: events.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') finish('skipped');
  }, { capture: true, signal: events.signal });
  document.addEventListener('focusin', event => {
    if (!entrance.contains(event.target)) finish('skipped');
  }, { signal: events.signal });
  window.addEventListener('scroll', () => finish('skipped'), { passive: true, signal: events.signal });
  window.addEventListener('hashchange', () => finish('direct-link'), { signal: events.signal });
  window.addEventListener('pagehide', () => finish('left-page'), { signal: events.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') finish('background');
  }, { signal: events.signal });
  entrance.addEventListener('pointermove', event => {
    if (entrance.classList.contains('is-entering') || !finePointer.matches || event.pointerType === 'touch') return;
    const x = (Math.max(0, Math.min(1, event.clientX / window.innerWidth)) - .5) * 18;
    const y = (Math.max(0, Math.min(1, event.clientY / window.innerHeight)) - .5) * 14;
    entrance.style.setProperty('--parallax-x', `${x.toFixed(2)}px`);
    entrance.style.setProperty('--parallax-y', `${y.toFixed(2)}px`);
  }, { passive: true, signal: events.signal });
  entrance.addEventListener('pointerleave', () => {
    entrance.style.setProperty('--parallax-x', '0px');
    entrance.style.setProperty('--parallax-y', '0px');
  }, { signal: events.signal });
  for (const preference of [reducedMotion, compactView, forcedColors]) {
    preference.addEventListener('change', event => {
      if (event.matches) finish('preference-change');
    }, { signal: events.signal });
  }
  entrance.addEventListener('animationend', event => {
    if (event.target === entrance && event.animationName === 'entrance-dismiss') finish('finished');
  }, { signal: events.signal });

  // The native #home link remains an escape if entrance enhancement fails.
}
