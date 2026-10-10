export const MAX_GROUPS = 6;
export const MAX_DROPLETS = 8;
export const MAX_SCOOPS = MAX_GROUPS + MAX_DROPLETS + 12;
export const PLACEMENT_SLOTS = 12;
export const DEFAULT_SCENE_SEED = 2;
export const CLUMP_PROFILES = Object.freeze([
  [[0, 0, .64, 1], [-.42, .36, .40, .8], [.37, .47, .34, .6]],
  [[0, 0, .61, 1], [.45, -.30, .45, .7]],
  [[0, 0, .65, 1], [-.42, .30, .40, .8], [.35, .53, .30, .5]],
  [[0, 0, .62, 1], [-.52, .24, .40, .7]],
  [[0, 0, .62, 1], [-.31, .41, .46, .8], [.46, -.38, .36, .6]],
  [[0, 0, .59, 1], [.43, .25, .49, .7]],
].map(profile => Object.freeze(profile.map(lobe => Object.freeze(lobe)))));
export const MAX_PRIMITIVES = MAX_SCOOPS + 1 + CLUMP_PROFILES.reduce((sum, profile) => sum + profile.length - 1, 0);
export const TRAIL_PROFILE = Object.freeze({ links: 8, headFraction: .024, startRadius: .72, endRadius: .12, maxGap: 3.2, lengthScale: .66 });
export const MOTION_PROFILE = Object.freeze({
  speedMultiplier: 1.125 * .25 * 1.5 * 1.5, breathRate: .155 * .25 * 1.5 * 1.5, lobeRate: 1.5,
  horizontalRadius: 2.2, minimumHorizontal: .14,
  horizontalViewport: .30, verticalRadius: 1.0, verticalViewport: .20, sideFraction: .46,
});
export const CREAM_PROFILE = Object.freeze({
  domeHeight: .34, domeFalloff: .85, peakHeight: .42, peakWidth: .38,
  peakRoundness: .15, peakFalloff: 1.7, weightFalloff: 3, rimWidth: .018,
});

export function createSceneRecipe(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('An unsigned 32-bit scene seed is required.');
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  const count = 4 + Math.floor(random() * 3), flip = random() < .5;
  const profiles = [0, 1, 2, 3, 4, 5];
  for (let i = profiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
  }
  const clumps = [], peaks = [0, .85, .6, 0, .9, 0];
  for (let index = 0; index < count; index++) {
    const radius = index === 0 ? .28 + random() * .03 : index === 1 ? .16 + random() * .025 : .054 + random() * .018;
    const amplitude = index < 2 ? .009 + random() * .002 : .014 + random() * .009;
    const orbit = Object.freeze([amplitude, amplitude * (.65 + random() * .25)]);
    // Pack complete breathing/orbit envelopes, not just the lobes at the first frame.
    const guard = radius * 1.05 + Math.hypot(...orbit), edge = guard + .008;
    const side = index % 2 ? 'right' : 'left';
    const preferredX = index === 0 ? .25 : index === 1 ? .80 : side === 'left' ? .10 : .90;
    const preferredY = index === 0 ? .25 : index === 1 ? .80 : index === 2 ? .85 : index === 3 ? .12 : .5;
    const targetX = Math.max(edge, Math.min(1 - edge, preferredX + (random() - .5) * .025));
    const targetY = Math.max(edge, Math.min(1 - edge, (flip ? 1 - preferredY : preferredY) + (random() - .5) * .025));
    const candidates = [[targetX, targetY]];
    for (let y = 0; y <= 32; y++) for (let x = 0; x <= 32; x++) {
      candidates.push([edge + (1 - edge * 2) * x / 32, edge + (1 - edge * 2) * y / 32]);
    }
    const valid = candidates.filter(([x, y]) => (side === 'left' ? x < .5 : x > .5) &&
      clumps.every(other => Math.hypot(x - other.x, y - other.y) >= guard + other.guard + .045));
    valid.sort((a, b) => Math.hypot(a[0] - targetX, a[1] - targetY) - Math.hypot(b[0] - targetX, b[1] - targetY));
    if (!valid.length) throw new RangeError('Scene envelopes cannot be safely separated.');
    const [x, y] = valid[0];
    clumps.push(Object.freeze({x, y, radius, peak: peaks[index], side, orbit, guard, clump: profiles[index]}));
  }
  const divergentLarge = Math.floor(random() * 2);
  const moving = [];
  const place = (item, gap) => {
    const edge = item.guard + .008;
    const candidates = [[item.x, item.y]];
    for (let y = 0; y <= 48; y++) for (let x = 0; x <= 48; x++) {
      candidates.push([edge + (1 - edge * 2) * x / 48, edge + (1 - edge * 2) * y / 48]);
    }
    const valid = candidates.filter(([x, y]) => x >= edge && x <= 1 - edge && y >= edge && y <= 1 - edge &&
      (item.kind === 'droplet' || (item.side === 'left' ? x < .5 : x > .5)) &&
      moving.every(other => Math.hypot(x - other.x, y - other.y) >= item.guard + other.guard + gap));
    const clearance = ([x, y]) => Math.min(x - edge, 1 - edge - x, y - edge, 1 - edge - y,
      ...moving.map(other => Math.hypot(x - other.x, y - other.y) - item.guard - other.guard - gap));
    if (!valid.length) {
      if (item.kind === 'droplet') return false;
      throw new RangeError(`Moving group envelope ${moving.length} cannot be safely separated.`);
    }
    const ranked = valid.map(position => ({position,
      clearance: item.kind === 'droplet' ? clearance(position) : 0,
      distance: Math.hypot(position[0] - item.x, position[1] - item.y)}));
    ranked.sort((a, b) => a.clearance - b.clearance || a.distance - b.distance);
    moving.push(Object.freeze({...item, x: ranked[0].position[0], y: ranked[0].position[1]}));
    return true;
  };
  for (let index = 0; index < count; index++) {
    const base = clumps[index], profile = CLUMP_PROFILES[base.clump];
    const mode = index < 2 ? (index === divergentLarge ? 'divergent' : 'together') : (random() < .35 ? 'divergent' : 'together');
    const lobe = 1 + Math.floor(random() * (profile.length - 1));
    const originalAngle = Math.atan2(profile[lobe][1], profile[lobe][0]);
    const angle = index < 2 ? Math.round(originalAngle / (Math.PI / 2)) * Math.PI / 2 + (random() - .5) * .12 :
      originalAngle + (random() - .5) * .7;
    const detachedRadius = index < 2 ? .10 : profile[lobe][2] * .8;
    const reach = index < 2 ? profile[0][2] + detachedRadius + .042 / base.radius : 1 - detachedRadius;
    const envelope = mode === 'divergent' ? Math.max(1, reach + detachedRadius) : 1;
    const lobeMotion = Object.freeze({mode, lobe, angle, detachedRadius, reach, canDetach: index < 2 && mode === 'divergent', period: 18 + random() * 8});
    place({...base, kind: 'group', lobeMotion, envelope,
      guard: base.radius * envelope * 1.05 + Math.hypot(...base.orbit)}, .035);
  }
  const requestedDropletCount = 5 + Math.floor(random() * 4);
  for (let index = 0; index < requestedDropletCount; index++) {
    const radius = .032 + random() * .008;
    const orbit = Object.freeze([.003 + random() * .004, .003 + random() * .004]);
    const x = .04 + random() * .92, y = .04 + random() * .92;
    const placed = place({x, y, radius, orbit, peak: 0, side: x < .5 ? 'left' : 'right', kind: 'droplet',
      envelope: 1, guard: radius * 1.05 + Math.hypot(...orbit)}, .024);
    if (!placed) {
      if (index < 5) throw new RangeError('At least five small droplets must fit safely.');
      break;
    }
  }
  return Object.freeze({seed, groupCount: count, dropletCount: moving.length - count, requestedDropletCount, clumps: Object.freeze(moving)});
}

export const DEFAULT_SCENE = createSceneRecipe(DEFAULT_SCENE_SEED);
export const SEED_SCOOPS = DEFAULT_SCENE.clumps.length;

export function seedScoops(width, height, recipe = DEFAULT_SCENE) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError('Positive preview dimensions required.');
  const unit = Math.min(width, height);
  return recipe.clumps.map(({x, y, radius, orbit, peak, side, clump, kind, lobeMotion, envelope}) => ({
    x: width * x, y: height * y, radius: unit * radius, peak, side, clump,
    orbit: orbit.map(value => value * unit), kind, lobeMotion, envelope,
  }));
}

function validateScoop(scoop) {
  if (!scoop || ![scoop.x, scoop.y, scoop.radius, scoop.peak ?? 0].every(Number.isFinite) ||
      scoop.radius <= 0 || (scoop.peak ?? 0) < 0 || (scoop.peak ?? 0) > 1 ||
      (scoop.clump !== undefined && (!Number.isInteger(scoop.clump) || scoop.clump < 0 || scoop.clump >= CLUMP_PROFILES.length)) ||
      (scoop.side !== undefined && !['left', 'right'].includes(scoop.side)) ||
      (scoop.orbit !== undefined && (!Array.isArray(scoop.orbit) || scoop.orbit.length !== 2 ||
        !scoop.orbit.every(value => Number.isFinite(value) && value >= 0))) ||
      (scoop.lobeMotion !== undefined && (!scoop.lobeMotion ||
        !['together', 'divergent'].includes(scoop.lobeMotion.mode) ||
        !Number.isInteger(scoop.lobeMotion.lobe) || scoop.lobeMotion.lobe < 1 ||
        scoop.lobeMotion.lobe >= (CLUMP_PROFILES[scoop.clump]?.length ?? 0) ||
        !['angle', 'detachedRadius', 'reach', 'period'].every(key => Number.isFinite(scoop.lobeMotion[key])) ||
        scoop.lobeMotion.period <= 0 || scoop.lobeMotion.detachedRadius <= 0 || scoop.lobeMotion.reach <= 0)) ||
      (scoop.lobeState !== undefined && (!Array.isArray(scoop.lobeState) ||
        scoop.lobeState.length !== CLUMP_PROFILES[scoop.clump]?.length ||
        !scoop.lobeState.every(lobe => Array.isArray(lobe) && lobe.length === 3 &&
          lobe.every(Number.isFinite) && lobe[2] > 0))) ||
      (scoop.band !== undefined && (!Array.isArray(scoop.band) || scoop.band.length !== 2 ||
        !scoop.band.every(Number.isFinite) || scoop.band[0] < 0 || scoop.band[1] > 1 ||
        scoop.band[0] >= scoop.band[1]))) {
    throw new RangeError('Finite scoop coordinates, positive radius, a zero-to-one peak and valid optional clump/side/motion band are required.');
  }
}

export function expandScoops(scoops) {
  if (!Array.isArray(scoops) || scoops.length > MAX_SCOOPS + 1) {
    throw new RangeError('A bounded array of logical scoops is required.');
  }
  const main = [], attached = [];
  scoops.forEach((scoop, parent) => {
    validateScoop(scoop);
    const profile = scoop.clump === undefined ? [[0, 0, 1, 1]] : CLUMP_PROFILES[scoop.clump];
    profile.forEach(([x, y, radius, peak], lobe) => {
      if (scoop.lobeState) [x, y, radius] = scoop.lobeState[lobe];
      const primitive = {x: scoop.x + x * scoop.radius, y: scoop.y + y * scoop.radius,
        radius: radius * scoop.radius, peak: peak * (scoop.peak ?? 0), parent, lobe};
      (lobe === 0 ? main : attached).push(primitive);
    });
  });
  if (main.length + attached.length > MAX_PRIMITIVES) throw new RangeError('Cream primitive capacity exceeded.');
  // Logical indices remain stable even when a derived satellite peels away.
  return [...main, ...attached];
}

function orbitCoordinate(anchor, extent, margin, travel, angle, direction) {
  if (anchor < margin || anchor > extent - margin) return anchor;
  const amplitude = Math.max(0, Math.min(travel, (extent - margin * 2) / 2));
  if (amplitude === 0) return anchor;
  // Shift the orbit inward near an edge rather than shrinking it to a tiny wiggle.
  const center = Math.max(margin + amplitude, Math.min(extent - margin - amplitude, anchor));
  const phase = Math.asin(Math.max(-1, Math.min(1, (anchor - center) / amplitude)));
  return center + amplitude * Math.sin(phase + angle * direction);
}

export function sampleScoops(scoops, seconds, width, height) {
  if (!Array.isArray(scoops) || scoops.length > MAX_SCOOPS + 1 ||
      ![seconds, width, height].every(Number.isFinite) || seconds < 0 || width <= 0 || height <= 0) {
    throw new RangeError('Bounded scoops, nonnegative time and positive viewport dimensions required.');
  }
  return scoops.map((scoop, index) => {
    validateScoop(scoop);
    const phase = index * 2.399963;
    const motionIndex = index;
    let lobeState;
    if (scoop.lobeMotion?.mode === 'divergent' && seconds > 0) {
      const movement = scoop.lobeMotion;
      const period = movement.period / MOTION_PROFILE.lobeRate;
      const spread = Math.sin(Math.PI * (seconds % period) / period) ** 2;
      lobeState = CLUMP_PROFILES[scoop.clump].map(([x, y, radius], lobe) => lobe !== movement.lobe ? [x, y, radius] : [
        x + (Math.cos(movement.angle) * movement.reach - x) * spread,
        y + (Math.sin(movement.angle) * movement.reach - y) * spread,
        radius + (movement.detachedRadius - radius) * spread,
      ]);
    }
    if (scoop.orbit) {
      return {...scoop,
        x: scoop.x + scoop.orbit[0] * Math.sin(seconds * (.27 + index % 3 * .025) * MOTION_PROFILE.speedMultiplier) * (index % 2 ? 1 : -1),
        y: scoop.y + scoop.orbit[1] * Math.sin(seconds * (.20 + index % 4 * .02) * MOTION_PROFILE.speedMultiplier) * (index % 3 ? -1 : 1),
        radius: scoop.radius * (1 + .025 * (Math.sin(phase + seconds * MOTION_PROFILE.breathRate) - Math.sin(phase))),
        ...(lobeState ? {lobeState} : {}),
      };
    }
    const laneWidth = scoop.side ? width * MOTION_PROFILE.sideFraction : width;
    const laneStart = scoop.side === 'right' ? width - laneWidth : 0;
    const bandStart = scoop.band ? height * scoop.band[0] : 0;
    const bandHeight = scoop.band ? height * (scoop.band[1] - scoop.band[0]) : height;
    const margin = scoop.radius * (scoop.band ? 1.08 : 1.05);
    const travelX = Math.min(width * MOTION_PROFILE.horizontalViewport,
      Math.max(scoop.radius * MOTION_PROFILE.horizontalRadius, width * MOTION_PROFILE.minimumHorizontal));
    const travelY = Math.min(scoop.radius * MOTION_PROFILE.verticalRadius, height * MOTION_PROFILE.verticalViewport);
    return {
      ...scoop,
      x: seconds === 0 ? scoop.x : laneStart + orbitCoordinate(scoop.x - laneStart, laneWidth, margin, travelX,
        seconds * (.27 + motionIndex % 3 * .025) * MOTION_PROFILE.speedMultiplier, motionIndex % 2 ? 1 : -1),
      y: seconds === 0 ? scoop.y : bandStart + orbitCoordinate(scoop.y - bandStart, bandHeight, margin, travelY,
        seconds * (.20 + motionIndex % 4 * .02) * MOTION_PROFILE.speedMultiplier, motionIndex % 3 ? -1 : 1),
      radius: scoop.radius * (1 + .025 * (Math.sin(phase + seconds * MOTION_PROFILE.breathRate) - Math.sin(phase))),
      peak: scoop.peak ?? 0,
    };
  });
}

export function scoopHeight(scoop, index, x, y) {
  validateScoop(scoop);
  if (![index, x, y].every(Number.isFinite) || !Number.isInteger(index) || index < 0) {
    throw new RangeError('Finite sample coordinates and a nonnegative scoop index required.');
  }
  const p = CREAM_PROFILE, angle = index * 2.399963 + .35;
  const q = Math.hypot(x - scoop.x, y - scoop.y) / scoop.radius;
  const tipX = scoop.x + Math.cos(angle) * scoop.radius * .12;
  const tipY = scoop.y + Math.sin(angle) * scoop.radius * .10;
  const tipDistance = Math.hypot(x - tipX, y - tipY) / (scoop.radius * p.peakWidth);
  const tip = Math.exp(-p.peakFalloff * (Math.sqrt(tipDistance ** 2 + p.peakRoundness ** 2) - p.peakRoundness));
  return scoop.radius * (p.domeHeight * Math.exp(-q * q * p.domeFalloff) +
    p.peakHeight * (scoop.peak ?? 0) * tip);
}

export function smoothUnion(first, second, blend) {
  if (![first, second, blend].every(Number.isFinite) || blend <= 0) throw new RangeError('Finite distances and positive blend required.');
  const h = Math.max(blend - Math.abs(first - second), 0) / blend;
  return Math.min(first, second) - h * h * blend * .25;
}

export function followPointer(position, target, elapsed) {
  if (![position.x, position.y, target.x, target.y, elapsed].every(Number.isFinite) || elapsed < 0) {
    throw new RangeError('Finite pointer coordinates and nonnegative time required.');
  }
  const weight = 1 - Math.exp(-Math.min(elapsed, 50) / 82);
  return {x: position.x + (target.x - position.x) * weight,
    y: position.y + (target.y - position.y) * weight};
}

export function cursorRadius(width, height) {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError('Positive preview dimensions required.');
  }
  return Math.min(width, height) * TRAIL_PROFILE.headFraction;
}

export function resetTrail(head) {
  if (!head || ![head.x, head.y].every(Number.isFinite)) throw new RangeError('Finite trail head required.');
  return Array.from({ length: TRAIL_PROFILE.links }, () => ({ ...head }));
}

function validateTrail(points, head) {
  if (!Array.isArray(points) || points.length !== TRAIL_PROFILE.links || !head ||
      ![head.x, head.y].every(Number.isFinite) ||
      !points.every(point => point && [point.x, point.y].every(Number.isFinite))) {
    throw new RangeError('A bounded finite trail and head are required.');
  }
}

export function sampleTrail(points, head) {
  validateTrail(points, head);
  const scale = TRAIL_PROFILE.lengthScale;
  return points.map(point => ({
    x: head.x + (point.x - head.x) * scale,
    y: head.y + (point.y - head.y) * scale,
  }));
}

export function followTrail(points, head, elapsed, radius) {
  validateTrail(points, head);
  if (![elapsed, radius].every(Number.isFinite) || elapsed < 0 || radius <= 0) {
    throw new RangeError('Positive trail radius and nonnegative time required.');
  }
  if (elapsed === 0) return points.map(point => ({ ...point }));
  let lead = head;
  return points.map((point, index) => {
    const weight = 1 - Math.exp(-Math.min(elapsed, 50) / (64 + index * 8));
    let next = { x: point.x + (lead.x - point.x) * weight, y: point.y + (lead.y - point.y) * weight };
    const dx = next.x - lead.x, dy = next.y - lead.y, gap = Math.hypot(dx, dy);
    if (gap < .025) next = { ...lead };
    else if (gap > radius * TRAIL_PROFILE.maxGap) {
      const scale = radius * TRAIL_PROFILE.maxGap / gap;
      next = { x: lead.x + dx * scale, y: lead.y + dy * scale };
    }
    lead = next;
    return next;
  });
}

export function outputSize(width, height, requestedRatio) {
  if (![width, height, requestedRatio].every(Number.isFinite) || width <= 0 || height <= 0 || requestedRatio <= 0) {
    throw new RangeError('Positive dimensions and pixel ratio required.');
  }
  const ratio = Math.min(2, Math.max(1, requestedRatio), Math.sqrt(8400000 / (width * height)));
  if (ratio < 1) return null;
  return {width: Math.ceil(width * ratio), height: Math.ceil(height * ratio), ratio};
}
