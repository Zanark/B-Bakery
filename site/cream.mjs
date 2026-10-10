export const CREAM_FRAME_INTERVAL = 1000 / 30;
export const CREAM_PIXEL_BUDGET = 2_000_000;

export function creamOutputSize(width, height, requestedRatio, limit = 16384, viewport = [limit, limit]) {
  if (![width, height, requestedRatio, limit, ...viewport].every(value => Number.isFinite(value) && value > 0) ||
      viewport.length !== 2) throw new RangeError('Positive viewport dimensions and graphics limits required.');
  const ratio = Math.min(1.5, requestedRatio, Math.sqrt(CREAM_PIXEL_BUDGET / (width * height)),
    Math.floor(limit) / width, Math.floor(limit) / height,
    Math.floor(viewport[0]) / width, Math.floor(viewport[1]) / height);
  if (ratio < .5) return null;
  const output = { width: Math.ceil(width * ratio), height: Math.ceil(height * ratio), ratio };
  return output.width * output.height <= 2_020_000 ? output : null;
}

export function creamLifecycle({ failed, lost, enabled = true, reduced, forced, printing, hidden,
  blurred, pageHidden, entrance, dialog, paused }) {
  const reason = failed ? 'failed' : lost ? 'context-lost' : !enabled ? 'disabled' :
    reduced ? 'reduced-motion' : forced ? 'forced-colors' : printing ? 'print' :
      pageHidden ? 'page-hidden' : hidden ? 'hidden' : blurred ? 'blurred' :
        entrance ? 'entrance' : dialog ? 'dialog' : '';
  return { visible: !reason, animate: !reason && !paused, reason: reason || (paused ? 'paused' : 'moving') };
}

export function creamElapsed(previous, now) {
  if (![previous, now].every(Number.isFinite) || previous < 0 || now < previous) {
    throw new RangeError('Monotonic nonnegative frame times required.');
  }
  return previous === 0 ? 0 : Math.min(50, now - previous);
}

export function creamModuleUrl(path, base = import.meta.url) {
  const url = new URL(path, base);
  url.search = new URL(base).search;
  return url.href;
}

function createRenderer(canvas, pointerCanvas, model, sources) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: true, antialias: true, depth: false,
    preserveDrawingBuffer: true, powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL2 is unavailable.');
  const pointerContext = pointerCanvas.getContext('2d');
  if (!pointerContext) console.warn('The optional cream cursor is unavailable; retaining the native pointer.');
  const shaders = [];
  let program, geometry, uniforms, limit, viewport;
  const dispose = () => {
    if (geometry) gl.deleteBuffer(geometry);
    if (program) gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    geometry = program = undefined;
    shaders.length = 0;
  };
  const compile = (kind, source) => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('Cream shader allocation failed.');
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Cream shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  };
  try {
    program = gl.createProgram();
    if (!program) throw new Error('Cream program allocation failed.');
    compile(gl.VERTEX_SHADER, sources.vertex);
    compile(gl.FRAGMENT_SHADER, sources.fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Cream shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    shaders.forEach(shader => { gl.detachShader(program, shader); gl.deleteShader(shader); });
    shaders.length = 0;
    gl.useProgram(program);
    geometry = gl.createBuffer();
    if (!geometry) throw new Error('Cream geometry allocation failed.');
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    if (position < 0) throw new Error('Cream vertex position is unavailable.');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(['resolution', 'pixelRatio', 'viewSize', 'scoopCount', 'scoops',
      'trail', 'trailCount', 'headRadius', 'cursorTint'].map(name =>
      [name, gl.getUniformLocation(program, ['scoops', 'trail'].includes(name) ? `${name}[0]` : name)]));
    if (Object.values(uniforms).some(value => value === null)) throw new Error('Cream material uniforms are unavailable.');
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    viewport = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Cream graphics setup failed.');
  } catch (error) {
    dispose();
    throw error;
  }
  const data = new Float32Array(model.MAX_PRIMITIVES * 4);
  const pointerData = new Float32Array(model.MAX_PRIMITIVES * 4);
  const trailData = new Float32Array(model.TRAIL_PROFILE.links * 4);
  return {
    dispose,
    outputSize(width, height, ratio) { return creamOutputSize(width, height, ratio, limit, viewport); },
    draw({ width, height, output, primitives, cursor, trail, pointerActive }) {
      if (gl.isContextLost()) throw new Error('Cream graphics context was lost during rendering.');
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.pixelRatio, output.ratio);
      gl.uniform2f(uniforms.viewSize, width, height);
      const radius = model.cursorRadius(width, height), path = model.sampleTrail(trail, cursor);
      let lead = cursor, segments = 0, pointerPainted = false;
      path.forEach((point, index) => {
        trailData.set([lead.x, lead.y, point.x, point.y], index * 4);
        if (Math.hypot(point.x - lead.x, point.y - lead.y) >= .5) segments++;
        lead = point;
      });
      gl.uniform4fv(uniforms.trail, trailData);
      gl.uniform1f(uniforms.headRadius, radius);
      if (pointerActive && pointerContext && !pointerContext.isContextLost?.()) {
        const margin = radius + 14 + Math.min(width, height) * .04, points = [cursor, ...path];
        const left = Math.max(0, Math.floor((Math.min(...points.map(point => point.x)) - margin) * output.ratio));
        const top = Math.max(0, Math.floor((Math.min(...points.map(point => point.y)) - margin) * output.ratio));
        const right = Math.min(canvas.width, Math.ceil((Math.max(...points.map(point => point.x)) + margin) * output.ratio));
        const bottom = Math.min(canvas.height, Math.ceil((Math.max(...points.map(point => point.y)) + margin) * output.ratio));
        const cropWidth = right - left, cropHeight = bottom - top;
        if (cropWidth > 0 && cropHeight > 0) {
          if (pointerCanvas.width !== cropWidth) pointerCanvas.width = cropWidth;
          if (pointerCanvas.height !== cropHeight) pointerCanvas.height = cropHeight;
          Object.assign(pointerCanvas.style, { left: `${left / output.ratio}px`, top: `${top / output.ratio}px`,
            width: `${cropWidth / output.ratio}px`, height: `${cropHeight / output.ratio}px` });
          pointerData.fill(0);
          pointerData.set([cursor.x, cursor.y, radius, 0]);
          gl.uniform1i(uniforms.scoopCount, 1);
          gl.uniform4fv(uniforms.scoops, pointerData);
          gl.uniform1i(uniforms.trailCount, trail.length);
          gl.uniform1f(uniforms.cursorTint, 1);
          // The small transparent cursor pass is copied above content; the full canvas stays ivory-only.
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(left, canvas.height - bottom, cropWidth, cropHeight);
          try {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            pointerContext.clearRect(0, 0, cropWidth, cropHeight);
            pointerContext.drawImage(canvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
            pointerPainted = true;
          } finally {
            gl.disable(gl.SCISSOR_TEST);
          }
        }
      }
      data.fill(0);
      primitives.forEach((scoop, index) => data.set([scoop.x, scoop.y, scoop.radius, scoop.peak], index * 4));
      gl.uniform1i(uniforms.scoopCount, primitives.length);
      gl.uniform4fv(uniforms.scoops, data);
      gl.uniform1i(uniforms.trailCount, 0);
      gl.uniform1f(uniforms.cursorTint, 0);
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Cream material rendering failed.');
      return { pointerPainted, segments, radius };
    },
  };
}

const instances = new WeakMap();

export function initCreamEffect({ model } = {}) {
  const layer = document.getElementById('cream-effects');
  if (!layer || document.body.dataset.creamEffects !== 'enabled') return Promise.resolve();
  if (instances.has(layer)) return instances.get(layer);
  const instance = initialize(layer, model);
  instances.set(layer, instance);
  return instance;
}

async function initialize(layer, model) {
  const canvas = document.getElementById('cream-material');
  const pointerCanvas = document.getElementById('cream-cursor');
  const control = document.getElementById('cream-motion-control');
  const button = document.getElementById('cream-motion-toggle');
  const entrance = document.getElementById('bakery-entrance');
  const body = document.body;
  const revision = new URL(import.meta.url).searchParams.get('v') || 'unversioned';
  let renderer, sources, recipe, output, frame, overlays, controlsObserver, stylesObserver;
  let width = 0, height = 0, ratio = 0, scoops = [], paintCount = 0, motionTime = 0, lastTime = 0;
  let paused = false, lost = false, failed = false, disposed = false, pageHidden = false, printEvent = false;
  let blurred = !document.hasFocus(), pointerPresent = false, dirty = true, refreshing = false;
  let cursor = { x: 0, y: 0 }, target = { ...cursor }, trail;
  const events = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const printing = matchMedia('print');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const setData = values => {
    for (const node of [layer, canvas]) if (node) {
      for (const [key, value] of Object.entries(values)) {
        const text = String(value);
        if (node.dataset[key] !== text) node.dataset[key] = text;
      }
    }
  };
  const nativePointer = () => {
    body.classList.remove('cream-cursor-active');
    if (pointerCanvas) pointerCanvas.hidden = true;
    setData({ pointerActive: false });
  };
  const stop = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    lastTime = 0;
    nativePointer();
  };
  const hide = reason => {
    stop();
    pointerPresent = false;
    layer.hidden = true;
    if (control) control.hidden = true;
    body.classList.remove('has-cream-effects');
    setData({ state: reason, paused });
  };
  const fail = error => {
    failed = true;
    hide('failed');
    renderer?.dispose();
    renderer = undefined;
    setData({ error: error instanceof Error ? error.message : String(error) });
    console.warn('The optional cream effect is unavailable; the normal website remains usable.', error);
  };
  const entranceVisible = () => !!entrance && !entrance.hidden &&
    getComputedStyle(entrance).display !== 'none' && getComputedStyle(entrance).visibility !== 'hidden';
  const lifecycle = () => creamLifecycle({ failed: failed || disposed, lost,
    enabled: body.dataset.creamEffects === 'enabled', reduced: motion.matches, forced: forced.matches,
    printing: printEvent || printing.matches, hidden: document.hidden, blurred, pageHidden,
    entrance: entranceVisible(), dialog: !!document.querySelector('dialog[open]'), paused });
  const recoverFocus = () => {
    if (blurred && !document.hidden && document.hasFocus()) { blurred = false; lastTime = 0; }
  };
  const stylesReady = () => getComputedStyle(layer).getPropertyValue('--cream-effect-ready').trim() === '1';
  const controlFits = () => {
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      bounds.width >= 48 && bounds.height >= 48 && bounds.left >= 0 && bounds.top >= 0 &&
      bounds.right <= innerWidth + .5 && bounds.bottom <= innerHeight + .5 &&
      button.scrollWidth <= button.clientWidth + 1 && button.scrollHeight <= button.clientHeight + 1;
  };
  const resize = () => {
    const nextWidth = innerWidth, nextHeight = innerHeight, nextRatio = devicePixelRatio || 1;
    if (width === nextWidth && height === nextHeight && ratio === nextRatio && output) return;
    const next = renderer.outputSize(nextWidth, nextHeight, nextRatio);
    if (!next) throw new Error('Viewport exceeds the cream output budget or minimum half-resolution scale.');
    if (width && height) {
      const sx = nextWidth / width, sy = nextHeight / height;
      cursor = { x: cursor.x * sx, y: cursor.y * sy };
      target = { x: target.x * sx, y: target.y * sy };
      trail = trail.map(point => ({ x: point.x * sx, y: point.y * sy }));
    } else {
      cursor = { x: nextWidth * .48, y: nextHeight * .27 };
      target = { ...cursor };
      trail = model.resetTrail(cursor);
    }
    width = nextWidth; height = nextHeight; ratio = nextRatio; output = next;
    scoops = model.seedScoops(width, height, recipe);
    canvas.width = output.width; canvas.height = output.height;
    dirty = true;
    nativePointer();
    setData({ pixelRatio: output.ratio, outputWidth: output.width, outputHeight: output.height,
      outputPixels: output.width * output.height, viewportWidth: width, viewportHeight: height });
  };
  const render = animate => {
    const primitives = model.expandScoops(model.sampleScoops(scoops, motionTime, width, height));
    const painted = renderer.draw({ width, height, output, primitives, cursor, trail,
      pointerActive: animate && fine.matches && pointerPresent });
    // Never hide the native cursor before both GPU passes and the overlay copy succeed.
    pointerCanvas.hidden = !painted.pointerPainted;
    body.classList.toggle('cream-cursor-active', painted.pointerPainted);
    if (painted.pointerPainted) pointerCanvas.dataset.paintCount = String(Number(pointerCanvas.dataset.paintCount || 0) + 1);
    setData({ paintCount: ++paintCount, motionTime: motionTime.toFixed(4), primitiveCount: primitives.length,
      cursorRadius: painted.radius.toFixed(3), trailSegments: painted.segments, pointerActive: painted.pointerPainted });
    dirty = false;
  };
  const schedule = () => {
    if (frame === undefined && !disposed && lifecycle().animate) frame = requestAnimationFrame(tick);
  };
  function tick(time) {
    frame = undefined;
    const state = lifecycle();
    if (!state.animate) { refresh(); return; }
    if (lastTime && time - lastTime < CREAM_FRAME_INTERVAL - .25) { schedule(); return; }
    try {
      resize();
      const elapsed = creamElapsed(lastTime, time);
      motionTime += elapsed / 1000;
      if (pointerPresent && fine.matches) cursor = model.followPointer(cursor, target, elapsed);
      trail = model.followTrail(trail, cursor, elapsed, model.cursorRadius(width, height));
      lastTime = time;
      render(true);
      setData({ state: 'moving', paused });
      schedule();
    } catch (error) { fail(error); }
  }
  function refresh() {
    if (refreshing || disposed) return;
    const state = lifecycle();
    if (!state.visible) { hide(state.reason); return; }
    refreshing = true;
    try {
      if (!stylesReady()) throw new Error('Cream styles are unavailable.');
      if (!renderer) { renderer = createRenderer(canvas, pointerCanvas, model, sources); dirty = true; output = undefined; }
      resize();
      layer.hidden = false;
      control.hidden = false;
      button.setAttribute('aria-pressed', String(paused));
      const label = paused ? 'Resume cream motion' : 'Pause cream motion';
      if (button.textContent !== label) button.textContent = label;
      // No motion is offered without an on-screen, readable way to pause it.
      if (!controlFits()) { hide('control-fit'); return; }
      if (dirty) render(false);
      body.classList.add('has-cream-effects');
      setData({ state: state.reason, paused });
      if (state.animate) schedule();
      else stop();
    } catch (error) { fail(error); }
    finally { refreshing = false; }
  }
  const on = (node, type, handler, options = {}) =>
    node.addEventListener(type, handler, { ...options, signal: events.signal });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    hide('disposed');
    events.abort();
    overlays?.disconnect();
    controlsObserver?.disconnect();
    stylesObserver?.disconnect();
    renderer?.dispose();
    renderer = undefined;
  };
  setData({ state: 'initializing', revision, paintCount: 0, motionTime: '0.0000', paused: false, error: '' });
  try {
    if (!canvas || !pointerCanvas || !control || !button) throw new Error('Cream enhancement markup is incomplete.');
    if (!model || !['createSceneRecipe', 'seedScoops', 'sampleScoops', 'expandScoops', 'followPointer',
      'cursorRadius', 'resetTrail', 'followTrail', 'sampleTrail'].every(name => typeof model[name] === 'function')) {
      throw new TypeError('A complete cream model is required.');
    }
    if (!stylesReady()) throw new Error('Cream styles are unavailable.');
    const material = await import(creamModuleUrl('./cream-material.mjs'));
    sources = material.createCreamShaders(model);
    const seed = globalThis.crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
    recipe = model.createSceneRecipe(seed);
    setData({ sceneSeed: seed, groupCount: recipe.groupCount, dropletCount: recipe.dropletCount,
      scoopCount: recipe.clumps.length, seedCount: recipe.clumps.length,
      capacity: model.MAX_PRIMITIVES, primitiveCapacity: model.MAX_PRIMITIVES, logicalCapacity: model.MAX_SCOOPS });
    on(button, 'click', () => {
      recoverFocus();
      paused = !paused;
      target = { ...cursor };
      stop();
      refresh();
    });
    on(window, 'pointermove', event => {
      recoverFocus();
      if (!lifecycle().animate || !fine.matches || event.pointerType !== 'mouse' || event.buttons) {
        pointerPresent = false; nativePointer(); refresh(); return;
      }
      target = { x: event.clientX, y: event.clientY };
      if (!pointerPresent) { cursor = { ...target }; trail = model.resetTrail(cursor); }
      pointerPresent = target.x >= 0 && target.y >= 0 && target.x < innerWidth && target.y < innerHeight;
      refresh();
    }, { passive: true });
    on(window, 'pointerdown', () => { recoverFocus(); pointerPresent = false; nativePointer(); refresh(); }, { passive: true });
    on(document.documentElement, 'pointerleave', () => { pointerPresent = false; nativePointer(); }, { passive: true });
    on(window, 'pointercancel', () => { pointerPresent = false; nativePointer(); }, { passive: true });
    on(window, 'blur', () => { blurred = true; hide('blurred'); });
    on(window, 'focus', () => { recoverFocus(); refresh(); });
    on(document, 'focusin', () => { recoverFocus(); refresh(); });
    on(window, 'pagehide', () => { pageHidden = true; hide('page-hidden'); });
    on(window, 'pageshow', () => { pageHidden = false; recoverFocus(); refresh(); });
    on(document, 'visibilitychange', () => { stop(); recoverFocus(); refresh(); });
    on(window, 'beforeprint', () => { printEvent = true; refresh(); });
    on(window, 'afterprint', () => { printEvent = false; recoverFocus(); refresh(); });
    on(window, 'resize', refresh, { passive: true });
    on(window.visualViewport || window, 'resize', refresh, { passive: true });
    for (const query of [motion, forced, printing, fine]) on(query, 'change', () => {
      stop(); pointerPresent = false; refresh();
    });
    on(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      lost = true;
      hide('context-lost');
      renderer?.dispose();
      renderer = undefined;
      output = undefined;
      dirty = true;
    });
    on(canvas, 'webglcontextrestored', () => {
      if (failed || disposed) return;
      lost = false;
      recoverFocus();
      refresh();
    });
    overlays = new MutationObserver(records => {
      if (records.some(record => record.target === entrance || record.target.tagName === 'DIALOG' ||
          (record.target === body && record.attributeName === 'data-cream-effects') ||
          (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
            node.nodeType === 1 && (node.matches('dialog') || node.querySelector('dialog')))))) refresh();
    });
    overlays.observe(body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['open', 'hidden', 'class', 'data-state', 'data-cream-effects'] });
    stylesObserver = new MutationObserver(refresh);
    stylesObserver.observe(document.head, { childList: true });
    if (typeof ResizeObserver === 'function') {
      controlsObserver = new ResizeObserver(() => { if (!control.hidden) refresh(); });
      controlsObserver.observe(control);
    }
    if (document.fonts) {
      on(document.fonts, 'loadingdone', refresh);
      on(document.fonts, 'loadingerror', refresh);
      document.fonts.ready.then(() => { if (!disposed) refresh(); });
    }
    on(window, 'load', refresh);
    blurred = !document.hasFocus();
    refresh();
  } catch (error) { fail(error); }
  return Object.freeze({ dispose });
}
