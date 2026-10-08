const PADDING = 20;
const NEAR_DISTANCE = 72;

function createRenderer(canvas, image, width, height) {
  const gl = canvas.getContext('webgl', {
    alpha: true, antialias: true, depth: false, premultipliedAlpha: false,
    preserveDrawingBuffer: false, powerPreference: 'low-power',
  });
  if (!gl) return null;
  const shaders = [];
  const program = gl.createProgram();
  const vertices = gl.createBuffer();
  const triangles = gl.createBuffer();
  const texture = gl.createTexture();
  const dispose = () => {
    gl.deleteBuffer(vertices);
    gl.deleteBuffer(triangles);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
  };
  const compile = (kind, source) => {
    const shader = gl.createShader(kind);
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Awning shader could not compile: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  };
  try {
    compile(gl.VERTEX_SHADER, `
      attribute vec2 a_uv;
      attribute vec2 a_offset;
      attribute float a_shade;
      uniform vec2 u_size;
      uniform float u_padding;
      varying vec2 v_uv;
      varying float v_shade;
      void main() {
        vec2 point = a_uv * u_size + a_offset + vec2(0.0, u_padding);
        vec2 frame = u_size + vec2(0.0, u_padding * 2.0);
        gl_Position = vec4(point.x / frame.x * 2.0 - 1.0, 1.0 - point.y / frame.y * 2.0, 0.0, 1.0);
        v_uv = a_uv;
        v_shade = a_shade;
      }
    `);
    compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_cloth;
      varying vec2 v_uv;
      varying float v_shade;
      void main() {
        vec4 fabric = texture2D(u_cloth, v_uv);
        gl_FragColor = vec4(fabric.rgb * v_shade, fabric.a);
      }
    `);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Awning shader could not link: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const scale = Math.min(devicePixelRatio || 1, 2, limit / width,
      limit / (height + PADDING * 2), Math.sqrt(2_000_000 / (width * (height + PADDING * 2))));
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil((height + PADDING * 2) * scale));
    const raster = document.createElement('canvas');
    raster.width = canvas.width;
    raster.height = Math.max(1, Math.ceil(height * scale));
    const context = raster.getContext('2d');
    if (!context) throw new Error('Awning texture preparation is unavailable.');
    context.drawImage(image, 0, 0, raster.width, raster.height);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Awning texture upload failed.');
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(gl.getUniformLocation(program, 'u_size'), width, height);
    gl.uniform1f(gl.getUniformLocation(program, 'u_padding'), PADDING);
    gl.uniform1i(gl.getUniformLocation(program, 'u_cloth'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    for (const [name, size, offset] of [['a_uv', 2, 0], ['a_offset', 2, 8], ['a_shade', 1, 16]]) {
      const attribute = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 20, offset);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  let vertexData;
  let indexCount = 0;
  return {
    dispose,
    draw(model) {
      const { columns, rows, displacement } = model;
      const stride = columns + 1;
      if (!vertexData) {
        vertexData = new Float32Array(displacement.length * 5);
        const indices = new Uint16Array(columns * (rows.length - 1) * 6);
        let offset = 0;
        for (let row = 0; row < rows.length - 1; row++) {
          for (let col = 0; col < columns; col++) {
            const a = row * stride + col, b = a + stride;
            indices.set([a, b, a + 1, a + 1, b, b + 1], offset);
            offset += 6;
          }
        }
        indexCount = indices.length;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triangles);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      }
      for (let row = 0; row < rows.length; row++) {
        for (let col = 0; col <= columns; col++) {
          const index = row * stride + col, v = rows[row], u = col / columns;
          const z = displacement[index];
          const left = displacement[row * stride + Math.max(0, col - 1)];
          const right = displacement[row * stride + Math.min(columns, col + 1)];
          const top = Math.max(0, row - 1), bottom = Math.min(rows.length - 1, row + 1);
          const slopeX = (right - left) / (width / columns * 2);
          const slopeY = (displacement[bottom * stride + col] - displacement[top * stride + col]) /
            Math.max(1, (rows[bottom] - rows[top]) * height);
          const pinned = z === 0 && (row <= 1 || row === 8 || row === 9 || col === 0 || col === columns);
          vertexData.set([
            u, v, z * .24 * Math.sin(u * Math.PI * 2), z * (.35 + v * .4),
            pinned ? 1 : Math.max(.82, Math.min(1.16, 1 - slopeX * .16 - slopeY * .22)),
          ], index * 5);
        }
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    },
  };
}

export async function initAwningFabric({ createAwningCloth }) {
  const awning = document.querySelector('.site-awning');
  const image = awning?.querySelector('img');
  if (!awning || !image) return;
  if (typeof createAwningCloth !== 'function') throw new TypeError('Awning fabric requires its cloth model.');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const print = matchMedia('print');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const stylesReady = () => getComputedStyle(awning).getPropertyValue('--awning-fabric-ready').trim() === '1';
  if (!window.ResizeObserver || !stylesReady()) {
    awning.dataset.fabricState = 'unsupported';
    console.info('Awning fabric is unavailable; retaining the original static canopy.');
    return;
  }
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.className = 'awning-fabric';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  awning.append(canvas);
  let model, renderer, frame = 0, previousTime = 0, width = 0, height = 0, density = 0;
  let lastScroll = scrollY, pointer = null, disposed = false, failed = false, contextLost = false;
  const events = new AbortController();
  const entrance = document.getElementById('bakery-entrance');
  const blocked = () => reduced.matches || forced.matches || print.matches || document.hidden || !stylesReady() ||
    !!document.querySelector('dialog[open]') ||
    (!!entrance && !entrance.hidden && getComputedStyle(entrance).visibility !== 'hidden' &&
      getComputedStyle(entrance).display !== 'none');
  const visible = () => {
    const bounds = awning.getBoundingClientRect();
    return bounds.bottom > -NEAR_DISTANCE && bounds.top < innerHeight + NEAR_DISTANCE;
  };
  const restore = state => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    model?.reset();
    pointer = null;
    canvas.hidden = true;
    awning.classList.remove('is-fabric-active');
    awning.dataset.fabricState = state;
  };
  const renderFailure = error => {
    failed = true;
    restore('unavailable');
    renderer?.dispose();
    renderer = null;
    console.warn('Awning fabric could not render; retaining the original static canopy.', error);
  };
  const measure = () => {
    if (disposed || failed || contextLost) return;
    const bounds = awning.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      restore('hidden');
      return;
    }
    if (bounds.width === width && bounds.height === height && density === devicePixelRatio && renderer) return;
    restore('rest');
    width = bounds.width;
    height = bounds.height;
    density = devicePixelRatio;
    renderer?.dispose();
    renderer = null;
    if (reduced.matches || forced.matches || print.matches) return;
    try {
      model = createAwningCloth({ width, height });
      renderer = createRenderer(canvas, image, width, height);
      if (!renderer) {
        failed = true;
        awning.dataset.fabricState = 'unsupported';
        console.info('WebGL is unavailable; retaining the original static canopy.');
        return;
      }
      renderer.draw(model);
    } catch (error) {
      renderFailure(error);
    }
  };
  const tick = time => {
    frame = 0;
    if (disposed || failed || contextLost || blocked() || !visible()) {
      restore('rest');
      return;
    }
    try {
      const moving = model.step(previousTime ? (time - previousTime) / 1000 : 1 / 60);
      previousTime = time;
      renderer.draw(model);
      awning.dataset.fabricState = moving ? 'moving' : model.hasPointer ? 'held' : 'rest';
      if (moving) frame = requestAnimationFrame(tick);
      else {
        previousTime = 0;
        if (!model.hasPointer) restore('rest');
      }
    } catch (error) {
      renderFailure(error);
    }
  };
  const wake = () => {
    if (!renderer || failed || contextLost || blocked() || !visible()) return;
    canvas.hidden = false;
    awning.classList.add('is-fabric-active');
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const movePointer = event => {
    if (!fine.matches || event.pointerType === 'touch' || event.isPrimary === false || blocked()) return;
    measure();
    if (!model || !renderer || failed || contextLost) return;
    const bounds = awning.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const near = x >= -NEAR_DISTANCE && x <= width + NEAR_DISTANCE && y >= -NEAR_DISTANCE && y <= height + NEAR_DISTANCE;
    if (!near) {
      if (model.hasPointer) {
        model.clearPointer();
        wake();
      }
      pointer = null;
      return;
    }
    const now = performance.now();
    const speed = pointer ? Math.min(1800, Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) /
      Math.max(.016, (now - pointer.time) / 1000)) : 0;
    pointer = { x: event.clientX, y: event.clientY, time: now };
    model.setPointer(x, y, speed);
    wake();
  };
  const clearPointer = () => {
    pointer = null;
    if (model?.hasPointer) {
      model.clearPointer();
      wake();
    }
  };
  const scroll = () => {
    const delta = scrollY - lastScroll;
    lastScroll = scrollY;
    if (blocked() || !visible()) {
      restore('rest');
      return;
    }
    measure();
    if (!model || !renderer || failed || contextLost || Math.abs(delta) < .5) return;
    model.impulseScroll(Math.max(-160, Math.min(160, delta)));
    if (pointer && fine.matches) {
      const bounds = awning.getBoundingClientRect();
      model.setPointer(pointer.x - bounds.left, pointer.y - bounds.top, 0);
    }
    wake();
  };
  const refresh = () => {
    if (blocked() || !visible()) restore('rest');
    else measure();
  };
  window.addEventListener('pointermove', movePointer, { passive: true, signal: events.signal });
  document.documentElement.addEventListener('pointerleave', clearPointer, { passive: true, signal: events.signal });
  window.addEventListener('scroll', scroll, { passive: true, signal: events.signal });
  window.addEventListener('resize', refresh, { passive: true, signal: events.signal });
  window.addEventListener('blur', () => restore('rest'), { signal: events.signal });
  window.addEventListener('pagehide', () => restore('rest'), { signal: events.signal });
  window.addEventListener('pageshow', refresh, { signal: events.signal });
  document.addEventListener('visibilitychange', refresh, { signal: events.signal });
  for (const preference of [reduced, forced, print]) preference.addEventListener('change', refresh, { signal: events.signal });
  fine.addEventListener('change', clearPointer, { signal: events.signal });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextLost = true;
    restore('context-lost');
    renderer = null;
  }, { signal: events.signal });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    measure();
  }, { signal: events.signal });
  const resize = new ResizeObserver(refresh);
  resize.observe(awning);
  const overlays = new MutationObserver(refresh);
  if (entrance) overlays.observe(entrance, { attributes: true, attributeFilter: ['hidden', 'class', 'data-state'] });
  document.querySelectorAll('dialog').forEach(dialog => overlays.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  measure();
  return () => {
    disposed = true;
    restore('disposed');
    events.abort();
    resize.disconnect();
    overlays.disconnect();
    renderer?.dispose();
    canvas.remove();
  };
}
