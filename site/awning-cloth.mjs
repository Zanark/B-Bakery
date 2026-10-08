export const CLOTH_ROWS = Object.freeze([
  0, 16, 28, 42, 58, 76, 94, 110, 122, 130, 142, 154, 166, 176, 180,
].map((value) => value / 180));

const NEAR_DISTANCE = 72;
const FIXED_STEP = 1 / 120;
const MAX_SUBSTEPS = 8;
const MAX_SCROLL_DELTA = 240;
const MAX_POINTER_SPEED = 2400;
const GAUSSIAN_EDGE = Math.exp(-4);

function finiteNumber(value, name) {
  if (typeof value !== 'number') throw new TypeError(`${name} must be a number.`);
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createAwningCloth({ width, height, columns = 96 }) {
  finiteNumber(width, 'width');
  finiteNumber(height, 'height');
  finiteNumber(columns, 'columns');
  if (width <= 0 || height <= 0) throw new RangeError('Cloth dimensions must be positive.');
  if (!Number.isInteger(columns) || columns < 2 || columns > 256) {
    throw new RangeError('columns must be an integer between 2 and 256.');
  }

  const stride = columns + 1;
  const count = stride * CLOTH_ROWS.length;
  const displacement = new Float32Array(count);
  const velocity = new Float32Array(count);
  const target = new Float32Array(count);
  const compliance = new Float32Array(CLOTH_ROWS.length);
  const scrollShape = new Float32Array(count);
  const pinned = new Uint8Array(CLOTH_ROWS.length);
  const maxDisplacement = Math.min(14, Math.fround(height * 0.075));
  const maxVelocity = maxDisplacement * 12;
  const radiusX = clamp(width * 0.1, 80, 130);
  const radiusY = clamp(height * 0.42, 60, 85);
  const horizontalSpring = clamp((150 / (width / columns)) ** 2, 24, 160);
  const verticalSpring = 65;
  const positionEpsilon = maxDisplacement * 0.0005;
  const velocityEpsilon = maxDisplacement * 0.005;
  const accelerationEpsilon = maxDisplacement * 0.04;
  let pointer = null;
  let active = false;
  let accumulatedTime = 0;

  for (let row = 0; row < CLOTH_ROWS.length; row++) {
    // Both edges of each rigid rail stay fixed, not just the topmost mesh row.
    pinned[row] = row === 0 || row === 1 || row === 8 || row === 9 ? 1 : 0;
    if (pinned[row]) continue;
    const y = CLOTH_ROWS[row] * 180;
    compliance[row] = row < 8
      ? 0.55 * Math.sin(Math.PI * (y - 16) / 106)
      : 0.35 + 0.65 * (y - 130) / 50;
    for (let column = 1; column < columns; column++) {
      const x = column / columns;
      scrollShape[row * stride + column] = compliance[row] * Math.sin(Math.PI * x) *
        (0.65 + 0.35 * Math.cos(4 * Math.PI * x + CLOTH_ROWS[row] * 3));
    }
  }

  function clearPointer() {
    if (!pointer) return;
    pointer = null;
    target.fill(0);
    active = true;
  }

  function setPointer(x, y, speed = 0) {
    finiteNumber(x, 'pointer x');
    finiteNumber(y, 'pointer y');
    finiteNumber(speed, 'pointer speed');
    if (x < -NEAR_DISTANCE || x > width + NEAR_DISTANCE ||
        y < -NEAR_DISTANCE || y > height + NEAR_DISTANCE) {
      clearPointer();
      return;
    }
    const kick = clamp(speed, 0, MAX_POINTER_SPEED) / MAX_POINTER_SPEED *
      maxDisplacement * 3;
    if (pointer?.x === x && pointer?.y === y && kick === 0) return;
    pointer = { x, y };
    active = true;
    for (let row = 0; row < CLOTH_ROWS.length; row++) {
      if (pinned[row]) continue;
      const dy = (CLOTH_ROWS[row] * height - y) / radiusY;
      for (let column = 1; column < columns; column++) {
        const index = row * stride + column;
        const dx = (column / columns * width - x) / radiusX;
        const distanceSquared = dx * dx + dy * dy;
        const influence = distanceSquared < 4
          ? (Math.exp(-distanceSquared) - GAUSSIAN_EDGE) / (1 - GAUSSIAN_EDGE)
          : 0;
        target[index] = maxDisplacement * 0.78 * compliance[row] * influence;
        velocity[index] = clamp(
          velocity[index] + kick * compliance[row] * influence, -maxVelocity, maxVelocity,
        );
      }
    }
  }

  function impulseScroll(deltaPx) {
    finiteNumber(deltaPx, 'scroll delta');
    if (deltaPx === 0) return;
    const kick = clamp(deltaPx, -MAX_SCROLL_DELTA, MAX_SCROLL_DELTA) /
      MAX_SCROLL_DELTA * maxDisplacement * 5;
    for (let index = 0; index < count; index++) {
      velocity[index] = clamp(
        velocity[index] + kick * scrollShape[index], -maxVelocity, maxVelocity,
      );
    }
    active = true;
  }

  function integrate() {
    let largestAcceleration = 0;
    let largestVelocity = 0;
    let largestDisplacement = 0;
    for (let row = 0; row < CLOTH_ROWS.length; row++) {
      if (pinned[row]) continue;
      const restSpring = row < 8 ? 64 : 32;
      const damping = row < 8 ? 9 : 6.5;
      for (let column = 1; column < columns; column++) {
        const index = row * stride + column;
        const position = displacement[index];
        const above = displacement[index - stride];
        // The valance hem is free: a missing lower neighbor contributes no spring.
        const below = row + 1 < CLOTH_ROWS.length ? displacement[index + stride] : position;
        const acceleration = restSpring * (target[index] - position) +
          horizontalSpring * (displacement[index - 1] + displacement[index + 1] - 2 * position) +
          verticalSpring * (above + below - 2 * position) - damping * velocity[index];
        largestAcceleration = Math.max(largestAcceleration, Math.abs(acceleration));
        velocity[index] = clamp(
          velocity[index] + acceleration * FIXED_STEP, -maxVelocity, maxVelocity,
        );
      }
    }

    // Advance positions only after every spring has read the same mesh state.
    for (let row = 0; row < CLOTH_ROWS.length; row++) {
      for (let column = 0; column <= columns; column++) {
        const index = row * stride + column;
        if (pinned[row] || column === 0 || column === columns) {
          displacement[index] = 0;
          velocity[index] = 0;
          continue;
        }
        const next = displacement[index] + velocity[index] * FIXED_STEP;
        displacement[index] = clamp(next, -maxDisplacement, maxDisplacement);
        if (Math.abs(next) > maxDisplacement) velocity[index] = 0;
        largestDisplacement = Math.max(largestDisplacement, Math.abs(displacement[index]));
        largestVelocity = Math.max(largestVelocity, Math.abs(velocity[index]));
      }
    }

    const settled = largestVelocity <= velocityEpsilon && (pointer
      ? largestAcceleration <= accelerationEpsilon
      : largestDisplacement <= positionEpsilon);
    if (settled) {
      velocity.fill(0);
      if (!pointer) displacement.fill(0);
      active = false;
      accumulatedTime = 0;
    }
  }

  function step(deltaSeconds) {
    finiteNumber(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) throw new RangeError('deltaSeconds must not be negative.');
    if (!active || deltaSeconds === 0) return active;
    // Drop long-frame backlog; at most eight fixed steps keep every call bounded.
    accumulatedTime += Math.min(deltaSeconds, FIXED_STEP * MAX_SUBSTEPS);
    const substeps = Math.min(MAX_SUBSTEPS, Math.floor((accumulatedTime + 1e-12) / FIXED_STEP));
    accumulatedTime = Math.max(0, accumulatedTime - substeps * FIXED_STEP);
    for (let substep = 0; substep < substeps && active; substep++) integrate();
    return active;
  }

  function reset() {
    displacement.fill(0);
    velocity.fill(0);
    target.fill(0);
    pointer = null;
    active = false;
    accumulatedTime = 0;
  }

  return {
    columns,
    rows: CLOTH_ROWS,
    displacement,
    velocity,
    maxDisplacement,
    get hasPointer() { return pointer !== null; },
    setPointer,
    clearPointer,
    impulseScroll,
    step,
    reset,
  };
}
