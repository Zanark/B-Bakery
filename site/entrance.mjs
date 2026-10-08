export function phoneTiltLook(beta, gamma, reference, screenAngle = 0) {
  if (![beta, gamma, reference?.beta, reference?.gamma, screenAngle].every(Number.isFinite)) {
    throw new TypeError('Phone tilt requires finite orientation angles and a neutral reference.');
  }
  const difference = (value, neutral) => ((value - neutral + 540) % 360) - 180;
  const pitch = difference(beta, reference.beta), roll = difference(gamma, reference.gamma);
  const angle = screenAngle * Math.PI / 180;
  const normalize = value => Math.abs(value) <= .75 ? 0 :
    Math.sign(value) * Math.min(1, (Math.abs(value) - .75) / 14.25);
  return {
    x: normalize(roll * Math.cos(angle) + pitch * Math.sin(angle)),
    y: normalize(pitch * Math.cos(angle) - roll * Math.sin(angle)),
  };
}

export function initBakeryEntrance({ tryRingBell } = {}) {
  const entrance = document.getElementById('bakery-entrance');
  const enter = document.getElementById('entrance-enter');
  const skip = document.getElementById('entrance-skip');
  const tiltButton = document.getElementById('entrance-motion');
  const tiltStatus = document.getElementById('entrance-motion-status');
  const tools = document.querySelector('.entrance-tools');
  if (!entrance || !enter || !skip) return;
  if (typeof tryRingBell !== 'function') {
    throw new TypeError('The bakery entrance requires a bell playback function.');
  }

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactView = matchMedia('(max-height: 450px)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const printView = matchMedia('print');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const coarsePointer = matchMedia('(pointer: coarse)');
  const skipReason = reducedMotion.matches ? 'reduced-motion'
    : compactView.matches ? 'short-screen'
      : forcedColors.matches ? 'forced-colors'
        : printView.matches ? 'print'
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
  let enteredFromControl = false;
  let tiltEvents, tiltTimer, tiltRequest = 0, tiltActive = false, tiltPending = false;
  let controlsObserver;
  const events = new AbortController();
  entrance.dataset.state = 'waiting';

  const setLook = (x, y) => {
    for (const [name, value] of [['--look-x', x], ['--look-y', y]]) {
      const next = value.toFixed(4);
      if (entrance.style.getPropertyValue(name) !== next) entrance.style.setProperty(name, next);
    }
  };
  const stopTilt = (reset = true, message = '', label = 'Phone tilt') => {
    tiltRequest++;
    tiltEvents?.abort();
    tiltEvents = undefined;
    clearTimeout(tiltTimer);
    tiltActive = false;
    tiltPending = false;
    if (reset) {
      setLook(0, 0);
      delete entrance.dataset.tiltView;
    }
    if (tiltButton) {
      tiltButton.setAttribute('aria-pressed', 'false');
      tiltButton.removeAttribute('aria-busy');
      tiltButton.textContent = label;
    }
    if (tiltStatus) tiltStatus.textContent = message;
  };

  const finish = reason => {
    if (finished) return;
    const focused = document.activeElement;
    const returnFocus = focused === skip || focused === enter || focused === tiltButton ||
      (reason === 'finished' && enteredFromControl && focused === document.body);
    finished = true;
    stopTilt(false);
    controlsObserver?.disconnect();
    clearTimeout(fallbackTimer);
    events.abort();
    bell?.stop();
    entrance.hidden = true;
    entrance.dataset.state = reason;
    if (entrance.dataset.audio === 'waiting') entrance.dataset.audio = 'skipped';
    if (returnFocus) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
  };

  const beginEntrance = event => {
    event?.preventDefault();
    if (finished || entrance.classList.contains('is-entering')) return;
    enteredFromControl = document.activeElement === enter || document.activeElement === skip;
    stopTilt(false);
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
    if (tiltActive || entrance.classList.contains('is-entering') || !finePointer.matches || event.pointerType === 'touch') return;
    const x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth - .5) * 3.2));
    const y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight - .5) * 3.2));
    setLook(x, y);
  }, { passive: true, signal: events.signal });
  entrance.addEventListener('pointerleave', () => {
    if (!tiltActive) setLook(0, 0);
  }, { signal: events.signal });
  for (const preference of [reducedMotion, compactView, forcedColors, printView]) {
    preference.addEventListener('change', event => {
      if (event.matches) finish('preference-change');
    }, { signal: events.signal });
  }
  entrance.addEventListener('animationend', event => {
    if (event.target === entrance && event.animationName === 'entrance-dismiss') finish('finished');
  }, { signal: events.signal });

  const reserveTools = () => {
    if (finished || !tools) return;
    const space = `${Math.ceil(tools.getBoundingClientRect().bottom) + 12}px`;
    if (entrance.style.getPropertyValue('--entrance-tools-space') !== space) {
      entrance.style.setProperty('--entrance-tools-space', space);
    }
    if (tiltButton && !tiltButton.hidden) {
      const art = getComputedStyle(entrance.querySelector('.entrance-art'));
      if (innerHeight - parseFloat(art.paddingTop) - parseFloat(art.paddingBottom) < 260) {
        finish('controls-fit');
      }
    }
  };
  const orientationAngle = () => screen.orientation?.angle ??
    (typeof window.orientation === 'number' ? window.orientation : 0);
  const tiltAvailable = () => !!tiltButton && !!tiltStatus && isSecureContext &&
    coarsePointer.matches && typeof window.DeviceOrientationEvent === 'function' &&
    getComputedStyle(entrance).position === 'fixed';
  const updateTiltAvailability = () => {
    if (!tiltButton || finished) return;
    if (!tiltAvailable()) stopTilt();
    tiltButton.hidden = !tiltAvailable();
    reserveTools();
  };
  if (tiltButton && tiltStatus) {
    tiltButton.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (finished || entrance.dataset.state !== 'waiting' || tiltPending) return;
      if (tiltActive) {
        stopTilt(true, 'Phone tilt is off. You can still tap to enter.');
        return;
      }
      if (!tiltAvailable()) {
        stopTilt(true, 'Phone tilt is unavailable in this browser.', 'Tilt unavailable');
        return;
      }
      const request = ++tiltRequest;
      tiltPending = true;
      tiltButton.setAttribute('aria-busy', 'true');
      const Orientation = window.DeviceOrientationEvent;
      try {
        if (typeof Orientation.requestPermission === 'function' &&
            await Orientation.requestPermission() !== 'granted') {
          if (request === tiltRequest && !finished) {
            stopTilt(true, 'Motion permission was not granted. Tap or use Skip entrance instead.', 'Tilt not allowed');
          }
          return;
        }
      } catch (error) {
        if (request === tiltRequest && !finished) {
          console.warn('Optional phone tilt permission is unavailable; tap and Skip still work.', error);
          stopTilt(true, 'Phone tilt could not be enabled. Tap or use Skip entrance instead.', 'Tilt unavailable');
        }
        return;
      }
      if (request !== tiltRequest || finished || entrance.dataset.state !== 'waiting') return;
      tiltEvents = new AbortController();
      tiltActive = true;
      tiltPending = false;
      tiltButton.removeAttribute('aria-busy');
      tiltButton.textContent = 'Starting tilt';
      tiltStatus.textContent = 'Hold the phone comfortably while tilt starts.';
      let neutral, angle = orientationAngle(), last = -Infinity, look = { x: 0, y: 0 };
      setLook(0, 0);
      const noSamples = () => {
        tiltTimer = setTimeout(() => {
          console.info('Optional phone tilt supplied no usable orientation samples; tap and Skip remain available.');
          stopTilt(true, 'No motion data is available. Tap or use Skip entrance instead.', 'Tilt unavailable');
        }, 2500);
      };
      noSamples();
      window.addEventListener('deviceorientation', sample => {
        if (finished || entrance.dataset.state !== 'waiting' || !tiltActive ||
            !Number.isFinite(sample.beta) || !Number.isFinite(sample.gamma)) return;
        const nextAngle = orientationAngle();
        if (!neutral || nextAngle !== angle) {
          neutral = { beta: sample.beta, gamma: sample.gamma };
          angle = nextAngle;
          look = { x: 0, y: 0 };
          last = -Infinity;
          clearTimeout(tiltTimer);
          entrance.dataset.tiltView = 'on';
          setLook(0, 0);
          tiltButton.setAttribute('aria-pressed', 'true');
          tiltButton.textContent = 'Tilt on';
          tiltStatus.textContent = 'Phone tilt is on. Tilt gently to look around; tap Tilt on to turn it off.';
          return;
        }
        const now = performance.now();
        if (now - last < 32) return;
        last = now;
        const target = phoneTiltLook(sample.beta, sample.gamma, neutral, angle);
        look = { x: look.x + (target.x - look.x) * .3, y: look.y + (target.y - look.y) * .3 };
        setLook(look.x, look.y);
      }, { passive: true, signal: tiltEvents.signal });
    }, { signal: events.signal });
    coarsePointer.addEventListener('change', updateTiltAvailability, { signal: events.signal });
    updateTiltAvailability();
  }
  if (tools && !finished) {
    if (typeof ResizeObserver === 'function') {
      controlsObserver = new ResizeObserver(reserveTools);
      controlsObserver.observe(tools);
    }
    window.addEventListener('resize', reserveTools, { passive: true, signal: events.signal });
    reserveTools();
  }

  // The native #home link remains an escape if entrance enhancement fails.
}
