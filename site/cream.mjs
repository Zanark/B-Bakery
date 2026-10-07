export function createCreamField(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3 ||
      width > 260 || height > 180) throw new RangeError('Cream field dimensions must be bounded integers.');
  const size = width * height;
  const level = new Float32Array(size);
  const velocity = new Float32Array(size);
  const next = new Float32Array(size);
  return {
    width, height, level,
    clear() { level.fill(0); velocity.fill(0); next.fill(0); },
    stroke(x, y, radius, strength = .5) {
      if (![x, y, radius, strength].every(Number.isFinite) || radius <= 0 ||
          Math.abs(strength) > 1) throw new RangeError('Cream strokes require finite, bounded input.');
      const reach = radius * 2;
      for (let row = Math.max(1, Math.floor(y - reach)); row <= Math.min(height - 2, y + reach); row++) {
        for (let column = Math.max(1, Math.floor(x - reach)); column <= Math.min(width - 2, x + reach); column++) {
          const distance = Math.hypot(column - x, row - y) / radius;
          if (distance > 2) continue;
          const depression = -Math.exp(-distance * distance * 3.5);
          const rim = .5 * Math.exp(-((distance - 1.05) ** 2) * 9);
          const i = row * width + column;
          level[i] = Math.max(-2, Math.min(2, level[i] + strength * (depression + rim)));
        }
      }
    },
    step() {
      let energy = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          const laplacian = level[i - 1] + level[i + 1] + level[i - width] + level[i + width] - 4 * level[i];
          // Heavy damping gives the furrow a slow, thick settling motion rather than water ripples.
          velocity[i] = (velocity[i] + .10 * laplacian - .018 * level[i]) * .69;
          next[i] = (level[i] + velocity[i]) * .991;
          energy = Math.max(energy, Math.abs(next[i]));
        }
      }
      level.set(next);
      return energy;
    },
    pixels(data) {
      if (!(data instanceof Uint8ClampedArray) || data.length !== size * 4) {
        throw new RangeError('Cream pixel buffer must match the field dimensions.');
      }
      data.fill(0);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;
          const lighting = (level[i - 1] - level[i + 1]) * .65 +
            (level[i - width] - level[i + width]) * .85;
          const highlight = lighting > 0;
          data[i * 4] = highlight ? 255 : 169;
          data[i * 4 + 1] = highlight ? 253 : 137;
          data[i * 4 + 2] = highlight ? 246 : 102;
          data[i * 4 + 3] = Math.min(highlight ? 130 : 40, Math.abs(lighting) * 280);
        }
      }
    },
  };
}

export function initCreamSurface() {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = matchMedia('(forced-colors: active)');
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  const print = matchMedia('print');
  const allowed = () => !motion.matches && !contrast.matches && pointer.matches && !print.matches;
  if (!allowed() || navigator.connection?.saveData ||
      getComputedStyle(document.body).getPropertyValue('--cream-ready').trim() !== '1') return;

  const canvas = document.createElement('canvas');
  canvas.className = 'cream-surface';
  canvas.id = 'cream-surface';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.state = 'idle';
  canvas.hidden = true;
  const context = canvas.getContext('2d');
  const buffer = document.createElement('canvas');
  const paint = buffer.getContext('2d');
  if (!context || !paint) {
    console.warn('The optional cream surface has no canvas support; keeping the static background.');
    return;
  }
  document.body.append(canvas);

  const protectedSelector = [
    '.site-header', '.hero-copy', '.hero-art', '.story-section', '.order-section',
    '.section-heading', '.cake-weight-info', '.notebook-cover', '.category-notebook',
    '.site-footer', '.mobile-enquire', '.skip-link',
  ].join(',');
  let boxes = [];
  let field;
  let image;
  let frame;
  let previousTime = 0;
  let activeUntil = 0;
  let target;
  let brush;
  let ratio = 1;
  let width = 0;
  let height = 0;
  let layoutDirty = true;
  let disposed = false;

  const blocked = () => document.hidden || !allowed() || navigator.connection?.saveData ||
    !!document.querySelector('dialog[open]') ||
    !!document.querySelector('#bakery-entrance:not([hidden]):not([data-state="finished"]):not([data-state="unavailable"])');
  const stop = state => {
    cancelAnimationFrame(frame);
    frame = undefined;
    target = brush = undefined;
    previousTime = activeUntil = 0;
    field?.clear();
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true;
    canvas.dataset.state = state;
  };
  const measure = () => {
    width = innerWidth;
    height = innerHeight;
    ratio = Math.min(1.25, devicePixelRatio || 1);
    canvas.width = Math.ceil(width * ratio);
    canvas.height = Math.ceil(height * ratio);
    const scale = Math.max(7, width / 240, height / 160);
    field = createCreamField(Math.max(3, Math.ceil(width / scale)), Math.max(3, Math.ceil(height / scale)));
    buffer.width = field.width;
    buffer.height = field.height;
    image = paint.createImageData(field.width, field.height);
    layoutDirty = true;
  };
  const measureBoxes = () => {
    boxes = [...document.querySelectorAll(protectedSelector)].filter(node => node.getClientRects().length)
      .map(node => node.getBoundingClientRect()).filter(box => box.bottom >= -30 && box.top <= height + 30)
      .map(box => ({left: box.left - 22, top: box.top - 22, right: box.right + 22, bottom: box.bottom + 22}));
    layoutDirty = false;
  };
  const draw = () => {
    field.pixels(image.data);
    paint.putImageData(image, 0, 0);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.drawImage(buffer, 0, 0, width, height);
    // The overlay affects blank cream only: never ink, cakes, controls or green sections.
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000';
    context.shadowColor = '#000';
    context.shadowBlur = 16 * ratio;
    for (const box of boxes) context.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    context.restore();
  };
  const tick = now => {
    frame = undefined;
    if (disposed) return;
    if (blocked()) { stop('paused'); return; }
    if (now - previousTime < 1000 / 30) { frame = requestAnimationFrame(tick); return; }
    previousTime = now;
    if (layoutDirty) measureBoxes();
    if (target && now < activeUntil) {
      brush ||= {...target};
      const start = {...brush};
      brush.x += (target.x - brush.x) * .44;
      brush.y += (target.y - brush.y) * .44;
      const distance = Math.hypot(brush.x - start.x, brush.y - start.y);
      const radius = 42 * field.width / width;
      const samples = Math.min(10, Math.max(1, Math.ceil(distance / Math.max(1, radius * .5))));
      for (let step = 1; step <= samples; step++) {
        field.stroke(start.x + (brush.x - start.x) * step / samples,
          start.y + (brush.y - start.y) * step / samples, radius, .18 + Math.min(.3, distance * .04));
      }
    }
    const energy = field.step();
    draw();
    if (now > activeUntil && energy < .008) { stop('idle'); return; }
    canvas.hidden = false;
    canvas.dataset.state = 'active';
    frame = requestAnimationFrame(tick);
  };
  const onMove = event => {
    if (event.pointerType !== 'mouse' || event.buttons || blocked()) return;
    if (layoutDirty) measureBoxes();
    if (boxes.some(box => event.clientX >= box.left && event.clientX <= box.right &&
        event.clientY >= box.top && event.clientY <= box.bottom)) return;
    target = {x: event.clientX * field.width / width, y: event.clientY * field.height / height};
    activeUntil = performance.now() + 90;
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const onResize = () => { stop('idle'); measure(); };
  const onScroll = () => { stop('idle'); layoutDirty = true; };
  const onPreference = () => { if (!allowed()) stop('disabled'); };
  const onVisibility = () => { if (document.hidden) stop('paused'); };
  const observer = new MutationObserver(() => {
    layoutDirty = true;
    if (blocked()) stop('paused');
  });
  measure();
  for (const node of document.querySelectorAll('dialog, #bakery-entrance, #cake-gallery')) {
    observer.observe(node, {attributes: true, attributeFilter: ['open', 'hidden', 'data-state']});
  }
  const boundsObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { layoutDirty = true; }) : null;
  for (const node of document.querySelectorAll(protectedSelector)) boundsObserver?.observe(node);
  document.fonts?.addEventListener('loadingdone', () => { layoutDirty = true; });
  document.fonts?.addEventListener('loadingerror', () => { layoutDirty = true; });
  window.addEventListener('pointermove', onMove, {passive: true});
  window.addEventListener('resize', onResize, {passive: true});
  window.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('blur', () => stop('paused'));
  document.addEventListener('pointerleave', () => stop('idle'));
  document.addEventListener('visibilitychange', onVisibility);
  for (const preference of [motion, contrast, pointer, print]) preference.addEventListener('change', onPreference);
  window.addEventListener('beforeprint', () => stop('disabled'));
  window.addEventListener('pagehide', () => {
    disposed = true;
    stop('disposed');
    observer.disconnect();
    boundsObserver?.disconnect();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      disposed = false;
      measure();
      canvas.dataset.state = 'idle';
      for (const node of document.querySelectorAll('dialog, #bakery-entrance, #cake-gallery')) {
        observer.observe(node, {attributes: true, attributeFilter: ['open', 'hidden', 'data-state']});
      }
      for (const node of document.querySelectorAll(protectedSelector)) boundsObserver?.observe(node);
    }
  });
}
