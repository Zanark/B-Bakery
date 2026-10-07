export const CREAM_TILE_SIZE = 384;
export const CREAM_MAX_TILE_PIXELS = 24 * 1024 * 1024;
const MAX_SURFACE_PIXELS = 8400000;
const HALF_WIDTH = 34;

export function creamPixelRatio(width, height, deviceRatio = 1) {
  if (![width, height, deviceRatio].every(Number.isFinite) || width <= 0 || height <= 0 || deviceRatio <= 0) {
    throw new RangeError('Cream surface dimensions and pixel ratio must be positive and finite.');
  }
  const ratio = Math.min(2, Math.max(1, deviceRatio), Math.sqrt(MAX_SURFACE_PIXELS / (width * height)));
  return ratio >= 1 ? ratio : 0;
}

export function creamStrokeGeometry(points) {
  if (!Array.isArray(points) || !points.length || points.length > 192 ||
      points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        Math.abs(point.x) > 10000000 || Math.abs(point.y) > 10000000)) {
    throw new RangeError('A cream stroke needs one to 192 finite points.');
  }
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 1)];
    const length = Math.hypot(after.x - before.x, after.y - before.y);
    return {x: point.x, y: point.y, nx: length ? -(after.y - before.y) / length : 0,
      ny: length ? (after.x - before.x) / length : 1};
  });
}

export function creamTileKeys(points) {
  const geometry = creamStrokeGeometry(points);
  const keys = new Set();
  for (const point of geometry) {
    for (let row = Math.max(0, Math.floor((point.y - 80) / CREAM_TILE_SIZE));
      row <= Math.floor((point.y + 80) / CREAM_TILE_SIZE); row++) {
      for (let column = Math.max(0, Math.floor((point.x - 80) / CREAM_TILE_SIZE));
        column <= Math.floor((point.x + 80) / CREAM_TILE_SIZE); column++) {
        keys.add(`${column},${row}`);
      }
    }
  }
  return [...keys];
}

function offsetPoints(points, amount) {
  return points.map(point => ({x: point.x + point.nx * amount * (point.spread ?? 1),
    y: point.y + point.ny * amount * (point.spread ?? 1)}));
}

function curve(context, points, move = true) {
  if (move) context.moveTo(points[0].x, points[0].y);
  else context.lineTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    context.quadraticCurveTo(points[i].x, points[i].y,
      (points[i].x + points[i + 1].x) / 2, (points[i].y + points[i + 1].y) / 2);
  }
  context.lineTo(points.at(-1).x, points.at(-1).y);
}

function profile(position) {
  return .9 * Math.exp(-(((position + .59) / .24) ** 2)) +
    Math.exp(-(((position - .55) / .25) ** 2)) - .2 * Math.exp(-((position / .32) ** 2));
}

function paintPeak(context, point) {
  context.save();
  context.translate(point.x, point.y);
  context.rotate(Math.atan2(-point.nx, point.ny) * .25);
  const light = context.createLinearGradient(-25, -20, 27, 28);
  light.addColorStop(0, '#fffffa');
  light.addColorStop(.42, '#fffdf4');
  light.addColorStop(.72, '#ede9dc');
  light.addColorStop(1, '#cfc8b8');
  context.beginPath();
  context.moveTo(-30, 15);
  context.bezierCurveTo(-40, -7, -8, -12, -2, -48);
  context.bezierCurveTo(5, -30, 2, -17, 21, -6);
  context.bezierCurveTo(46, 12, 21, 34, -6, 32);
  context.bezierCurveTo(-18, 30, -27, 25, -30, 15);
  context.fillStyle = light;
  context.shadowColor = 'rgba(107, 81, 48, .15)';
  context.shadowBlur = 5;
  context.shadowOffsetY = 4;
  context.fill();
  context.shadowColor = 'transparent';
  context.beginPath();
  context.moveTo(-2, -43);
  context.bezierCurveTo(-1, -15, -22, 2, -16, 22);
  context.strokeStyle = 'rgba(255, 255, 249, .8)';
  context.lineWidth = 2.5;
  context.stroke();
  context.restore();
}

function paintStroke(context, raw, endPeak, startDistance = 0) {
  let distance = startDistance;
  const points = creamStrokeGeometry(raw).map((point, index) => {
    if (index) distance += Math.hypot(point.x - raw[index - 1].x, point.y - raw[index - 1].y);
    const taper = .2 + .8 * Math.min(1, distance / 62);
    const spread = taper * (.89 + .13 * Math.sin(distance * .024) + .055 * Math.sin(distance * .067));
    const drift = Math.sin(distance * .029) * 3.5 + Math.sin(distance * .011) * 2;
    return {...point, x: point.x + point.nx * drift, y: point.y + point.ny * drift, spread, distance};
  });
  if (points.length < 2) { if (endPeak) paintPeak(context, points[0]); return; }
  context.save();
  context.lineCap = context.lineJoin = 'round';
  context.beginPath();
  curve(context, offsetPoints(points, -HALF_WIDTH));
  curve(context, offsetPoints(points, HALF_WIDTH).reverse(), false);
  context.closePath();
  context.fillStyle = '#eee9dc';
  context.shadowColor = 'rgba(96, 85, 61, .17)';
  context.shadowBlur = 5;
  context.shadowOffsetX = 2;
  context.shadowOffsetY = 5;
  context.fill();
  context.shadowColor = 'transparent';
  const middle = points[Math.floor(points.length / 2)];
  const lightDirection = middle.nx * -.55 + middle.ny * -.75;
  // Native vector bands form a fixed sculpted cross-section, not an enlarged pixel grid.
  for (let band = 0; band < 64; band++) {
    const t = -1 + (band + .5) / 32;
    const slope = (profile(t + .01) - profile(t - .01)) / .02;
    const light = Math.max(0, Math.min(1, .77 - slope * lightDirection * .18 + profile(t) * .12));
    context.fillStyle = `rgb(${Math.round(208 + 47 * light)}, ${Math.round(200 + 55 * light)}, ${Math.round(181 + 70 * light)})`;
    context.beginPath();
    curve(context, offsetPoints(points, (t - .019) * HALF_WIDTH));
    curve(context, offsetPoints(points, (t + .019) * HALF_WIDTH).reverse(), false);
    context.closePath();
    context.fill();
  }
  for (const ridge of [-.59, .55]) {
    context.beginPath();
    curve(context, offsetPoints(points, ridge * HALF_WIDTH));
    context.strokeStyle = 'rgba(255, 255, 251, .35)';
    context.lineWidth = 1.1;
    context.stroke();
  }
  if (endPeak) paintPeak(context, points.at(-1));
  context.restore();
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
  canvas.id = 'cream-surface';
  canvas.className = 'cream-surface';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  canvas.dataset.state = 'ready';
  const context = canvas.getContext('2d');
  if (!context) {
    console.warn('The optional whipped-cream surface has no canvas support; keeping the static background.');
    return;
  }
  document.body.append(canvas);
  const protectedSelector = [
    '.site-header', '.hero-copy', '.hero-art', '.story-section', '.order-section',
    '.section-heading', '.cake-weight-info', '.notebook-cover', '.category-notebook',
    '.site-footer', '.mobile-enquire', '.skip-link',
  ].join(',');
  const tiles = new Map();
  let allocatedPixels = 0;
  let boxes = [];
  let stroke = [];
  let strokeOffset = 0;
  let strokes = 0;
  let frame;
  let finishTimer;
  let ratio = 1;
  let disposed = false;
  let full = false;
  let blurred = false;
  let layoutDirty = true;
  let measuredScrollX = 0;
  let measuredScrollY = 0;

  const blocked = () => disposed || blurred || document.hidden || !allowed() || !ratio || navigator.connection?.saveData ||
    !!document.querySelector('dialog[open]') ||
    !!document.querySelector('#bakery-entrance:not([hidden]):not([data-state="finished"]):not([data-state="unavailable"])');
  const measureBoxes = () => {
    boxes = [...document.querySelectorAll(protectedSelector)].filter(node => node.getClientRects().length)
      .map(node => node.getBoundingClientRect())
      .filter(box => box.bottom >= -30 && box.top <= innerHeight + 30)
      .map(box => ({left: box.left - 22, top: box.top - 22, right: box.right + 22, bottom: box.bottom + 22}));
    layoutDirty = false;
    measuredScrollX = scrollX;
    measuredScrollY = scrollY;
  };
  const ensureTiles = points => {
    const missing = creamTileKeys(points).filter(key => !tiles.has(key));
    const pixels = Math.ceil(CREAM_TILE_SIZE * ratio);
    if (allocatedPixels + missing.length * pixels * pixels > CREAM_MAX_TILE_PIXELS) {
      if (!full) console.warn('The cream surface has reached its memory budget; existing sculpted marks are retained.');
      full = true;
      return false;
    }
    for (const key of missing) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = pixels;
      const paint = tile.getContext('2d');
      if (!paint) {
        console.warn('A cream storage tile could not be created; keeping existing marks.');
        full = true;
        return false;
      }
      tiles.set(key, {canvas: tile, paint, ratio: pixels / CREAM_TILE_SIZE});
      allocatedPixels += pixels * pixels;
    }
    return true;
  };
  const draw = () => {
    frame = undefined;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (blocked()) {
      canvas.hidden = true;
      canvas.dataset.state = disposed ? 'disposed' : 'paused';
      return;
    }
    if (layoutDirty) measureBoxes();
    context.setTransform(ratio, 0, 0, ratio, -scrollX * ratio, -scrollY * ratio);
    for (const [key, tile] of tiles) {
      const [column, row] = key.split(',').map(Number);
      const x = column * CREAM_TILE_SIZE, y = row * CREAM_TILE_SIZE;
      if (x > scrollX + innerWidth || x + CREAM_TILE_SIZE < scrollX ||
          y > scrollY + innerHeight || y + CREAM_TILE_SIZE < scrollY) continue;
      context.drawImage(tile.canvas, x, y, CREAM_TILE_SIZE, CREAM_TILE_SIZE);
    }
    if (stroke.length) paintStroke(context, stroke, false, strokeOffset);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.save();
    context.globalCompositeOperation = 'destination-out';
    context.fillStyle = '#000';
    context.shadowColor = '#000';
    context.shadowBlur = 14 * ratio;
    for (const box of boxes) context.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    context.restore();
    canvas.hidden = strokes === 0 && stroke.length === 0;
    canvas.dataset.state = full ? 'full' : stroke.length ? 'drawing' : strokes ? 'set' : 'ready';
    canvas.dataset.strokeCount = String(strokes);
    canvas.dataset.pixelRatio = String(ratio);
    canvas.dataset.storedPixels = String(allocatedPixels);
  };
  const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(draw); };
  const finish = (peak = true) => {
    clearTimeout(finishTimer);
    if (!stroke.length) return;
    for (const key of creamTileKeys(stroke)) {
      const tile = tiles.get(key);
      if (!tile) throw new Error('A retained cream stroke is missing its reserved backing tile.');
      const [column, row] = key.split(',').map(Number);
      tile.paint.setTransform(tile.ratio, 0, 0, tile.ratio,
        -column * CREAM_TILE_SIZE * tile.ratio, -row * CREAM_TILE_SIZE * tile.ratio);
      paintStroke(tile.paint, stroke, peak, strokeOffset);
    }
    stroke = [];
    strokeOffset = 0;
    strokes++;
    schedule();
  };
  const resize = () => {
    finish();
    ratio = creamPixelRatio(innerWidth, innerHeight, devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.ceil(innerWidth * ratio));
    canvas.height = Math.max(1, Math.ceil(innerHeight * ratio));
    if (!ratio) console.warn('This viewport exceeds the cream surface resolution budget; keeping the static background.');
    layoutDirty = true;
    schedule();
  };
  const onMove = event => {
    if (event.pointerType !== 'mouse' || event.buttons || blocked() || full) return;
    if (event.target instanceof Element && event.target.closest(protectedSelector)) { finish(); return; }
    if (layoutDirty || measuredScrollX !== scrollX || measuredScrollY !== scrollY) measureBoxes();
    if (boxes.some(box => event.clientX >= box.left && event.clientX <= box.right &&
        event.clientY >= box.top && event.clientY <= box.bottom)) { finish(); return; }
    const point = {x: event.clientX + scrollX, y: event.clientY + scrollY};
    const previous = stroke.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 3) return;
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > 90) finish();
    if (!ensureTiles([point])) { finish(); schedule(); return; }
    stroke.push(point);
    if (stroke.length === 160) {
      const tail = stroke.slice(-2);
      let nextOffset = strokeOffset;
      for (let i = 1; i < stroke.length - 1; i++) {
        nextOffset += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y);
      }
      finish(false);
      stroke = tail;
      strokeOffset = nextOffset;
    }
    clearTimeout(finishTimer);
    finishTimer = setTimeout(finish, 160);
    schedule();
  };
  const refresh = () => { finish(); layoutDirty = true; schedule(); };
  const observer = new MutationObserver(refresh);
  const boundsObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    layoutDirty = true;
    schedule();
  }) : null;
  const observe = () => {
    for (const node of document.querySelectorAll('dialog, #bakery-entrance, #cake-gallery')) {
      observer.observe(node, {attributes: true, attributeFilter: ['open', 'hidden', 'data-state']});
    }
    for (const node of document.querySelectorAll(protectedSelector)) boundsObserver?.observe(node);
  };
  resize();
  observe();
  window.addEventListener('pointermove', onMove, {passive: true});
  window.addEventListener('pointerdown', () => finish(), {passive: true});
  document.addEventListener('pointerleave', () => finish());
  window.addEventListener('scroll', refresh, {passive: true});
  window.addEventListener('resize', resize, {passive: true});
  window.addEventListener('blur', () => { blurred = true; refresh(); });
  window.addEventListener('focus', () => { blurred = false; refresh(); });
  document.addEventListener('visibilitychange', refresh);
  document.fonts?.addEventListener('loadingdone', refresh);
  document.fonts?.addEventListener('loadingerror', refresh);
  for (const preference of [motion, contrast, pointer, print]) preference.addEventListener('change', refresh);
  window.addEventListener('beforeprint', refresh);
  window.addEventListener('afterprint', refresh);
  window.addEventListener('pagehide', () => {
    finish();
    disposed = true;
    cancelAnimationFrame(frame);
    frame = undefined;
    observer.disconnect();
    boundsObserver?.disconnect();
    draw();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      disposed = false;
      blurred = false;
      resize();
      observe();
    }
  });
}
