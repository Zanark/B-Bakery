export const MATERIALS = Object.freeze({
  plaster: 0, wood: 1, darkWood: 2, greenPaint: 3, brass: 4,
  glass: 5, ceramic: 6, bread: 7, icing: 8, chocolate: 9,
  leaf: 10, linen: 11, window: 12, stone: 13, berry: 14
});

const WHITE = [1, 1, 1, 1];
const TAU = Math.PI * 2;
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const add = (a, b) => a.map((value, i) => value + b[i]);
const scale = (a, amount) => a.map(value => value * amount);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const unit = a => scale(a, 1 / Math.hypot(...a));
const emptyGeometry = () => ({ positions: [], normals: [], uvs: [], colors: [], materials: [] });
const emptyBounds = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const typedGeometry = geometry => Object.fromEntries(
  Object.entries(geometry).map(([key, values]) => [key, new Float32Array(values)])
);

// The illustration is deliberately independent of catalogue photographs and recipes.
export function createBakeryScene() {
  const opaque = emptyGeometry();
  const transparent = [];
  const groups = [];
  const bounds = emptyBounds();
  const activeGroups = [];
  const landmarkPoints = {};
  let target = opaque;

  function include(point) {
    for (const extent of [bounds, ...activeGroups]) {
      for (let axis = 0; axis < 3; axis++) {
        const value = Math.fround(point[axis]);
        extent.min[axis] = Math.min(extent.min[axis], value);
        extent.max[axis] = Math.max(extent.max[axis], value);
      }
    }
  }

  function triangle(points, material, color = WHITE, uv, normals) {
    const face = cross(subtract(points[1], points[0]), subtract(points[2], points[0]));
    // A lathe pole emits one triangle, rather than a second zero-area triangle.
    if (Math.hypot(...face) < 1e-12) return;
    const faceNormal = unit(face);
    for (let i = 0; i < 3; i++) {
      target.positions.push(...points[i]);
      target.normals.push(...(normals?.[i] ?? faceNormal));
      target.uvs.push(...(uv?.[i] ?? [points[i][0], points[i][2]]));
      target.colors.push(...color);
      target.materials.push(material);
      include(points[i]);
    }
  }

  function quad(points, outward, material, color = WHITE) {
    const vertices = dot(cross(subtract(points[1], points[0]), subtract(points[2], points[0])), outward) < 0
      ? [points[0], points[3], points[2], points[1]] : points;
    const normal = unit(cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0])));
    const major = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const axes = major === 0 ? [2, 1] : major === 1 ? [0, 2] : [0, 1];
    const uv = vertices.map(point => axes.map(axis => point[axis]));
    for (const indices of [[0, 1, 2], [0, 2, 3]]) {
      triangle(indices.map(i => vertices[i]), material, color, indices.map(i => uv[i]));
    }
  }

  function box(min, max, material, color = WHITE) {
    const [x, y, z] = min;
    const [X, Y, Z] = max;
    quad([[x, y, z], [x, y, Z], [x, Y, Z], [x, Y, z]], [-1, 0, 0], material, color);
    quad([[X, y, z], [X, y, Z], [X, Y, Z], [X, Y, z]], [1, 0, 0], material, color);
    quad([[x, y, z], [X, y, z], [X, y, Z], [x, y, Z]], [0, -1, 0], material, color);
    quad([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]], [0, 1, 0], material, color);
    quad([[x, y, z], [X, y, z], [X, Y, z], [x, Y, z]], [0, 0, -1], material, color);
    quad([[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]], [0, 0, 1], material, color);
  }

  function bevelBox(min, max, material, bevel = 0.025, color = WHITE) {
    const b = Math.min(bevel, ...max.map((value, i) => (value - min[i]) / 4));
    function ring(y, inset) {
      const x = min[0] + inset, X = max[0] - inset;
      const z = min[2] + inset, Z = max[2] - inset;
      return [[x + b, y, z], [X - b, y, z], [X, y, z + b], [X, y, Z - b],
        [X - b, y, Z], [x + b, y, Z], [x, y, Z - b], [x, y, z + b]];
    }
    const rings = [ring(min[1], b), ring(min[1] + b, 0), ring(max[1] - b, 0), ring(max[1], b)];
    const center = min.map((value, i) => (value + max[i]) / 2);
    for (let level = 0; level < rings.length - 1; level++) {
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        const vertices = [rings[level][i], rings[level][next], rings[level + 1][next], rings[level + 1][i]];
        const outward = subtract(vertices.reduce((sum, p) => add(sum, scale(p, 0.25)), [0, 0, 0]), center);
        quad(vertices, outward, material, color);
      }
    }
    for (const [level, direction] of [[0, -1], [3, 1]]) {
      const ringPoints = rings[level];
      const middle = [center[0], ringPoints[0][1], center[2]];
      for (let i = 0; i < 8; i++) {
        const points = [middle, ringPoints[i], ringPoints[(i + 1) % 8]];
        if (direction > 0) points.reverse();
        triangle(points, material, color);
      }
    }
  }

  function group(id, floorContact, draw) {
    const extent = { id, ...emptyBounds(), floorContact };
    activeGroups.push(extent);
    draw();
    activeGroups.pop();
    groups.push(extent);
  }

  // Profiles run from the bottom axis, around the outside, to the top axis.
  // Circumference/profile-distance UVs retain world scale instead of stretching an atlas tile.
  function lathe(center, profile, material, color = WHITE, segments = 20, stretch = [1, 1], yaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rotate = vector => [vector[0] * c - vector[2] * s, vector[1], vector[0] * s + vector[2] * c];
    const point = ([r, y], angle) => add(center, rotate([r * Math.cos(angle) * stretch[0], y, r * Math.sin(angle) * stretch[1]]));
    const circumferenceRadius = Math.max(...profile.map(([radius]) => radius)) * Math.max(...stretch);
    let distance = 0;
    for (let level = 0; level < profile.length - 1; level++) {
      const a = profile[level], b = profile[level + 1];
      const dr = b[0] - a[0], dy = b[1] - a[1];
      const nextDistance = distance + Math.hypot(dr, dy);
      const normal = angle => unit(rotate([dy * Math.cos(angle) / stretch[0], -dr, dy * Math.sin(angle) / stretch[1]]));
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * TAU, next = (i + 1) / segments * TAU;
        const vertices = [point(a, angle), point(b, angle), point(b, next), point(a, next)];
        const normals = [normal(angle), normal(angle), normal(next), normal(next)];
        const uv = [[angle * circumferenceRadius, distance], [angle * circumferenceRadius, nextDistance],
          [next * circumferenceRadius, nextDistance], [next * circumferenceRadius, distance]];
        for (const indices of [[0, 1, 2], [0, 2, 3]]) {
          triangle(indices.map(j => vertices[j]), material, color, indices.map(j => uv[j]), indices.map(j => normals[j]));
        }
      }
      distance = nextDistance;
    }
  }

  function cylinder(center, radius, height, material, color = WHITE, segments = 20) {
    lathe(center, [[0, 0], [radius, 0], [radius, height], [0, height]], material, color, segments);
  }

  function rod(start, end, radius, material, color = WHITE, segments = 8) {
    const axis = unit(subtract(end, start));
    const u = unit(cross(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const v = cross(axis, u);
    const length = Math.hypot(...subtract(end, start));
    for (let i = 0; i < segments; i++) {
      const a = i * TAU / segments, b = (i + 1) * TAU / segments;
      const n0 = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
      const n1 = add(scale(u, Math.cos(b)), scale(v, Math.sin(b)));
      const p = [add(start, scale(n0, radius)), add(start, scale(n1, radius)),
        add(end, scale(n1, radius)), add(end, scale(n0, radius))];
      const uv = [[a * radius, 0], [b * radius, 0], [b * radius, length], [a * radius, length]];
      triangle([p[0], p[1], p[2]], material, color, [uv[0], uv[1], uv[2]], [n0, n1, n1]);
      triangle([p[0], p[2], p[3]], material, color, [uv[0], uv[2], uv[3]], [n0, n1, n0]);
      triangle([start, p[1], p[0]], material, color);
      triangle([end, p[3], p[2]], material, color);
    }
  }

  function dome(center, radius, height, material, color = WHITE, segments = 12, stretch = [1, 1], yaw = 0) {
    const profile = [[0, 0], [radius, 0]];
    for (let i = 1; i <= 4; i++) {
      const angle = i / 4 * Math.PI / 2;
      profile.push([i === 4 ? 0 : Math.cos(angle) * radius, Math.sin(angle) * height]);
    }
    lathe(center, profile, material, color, segments, stretch, yaw);
  }

  function berry(center, radius = 0.043) {
    lathe(center, [[0, 0], [radius * 0.85, radius * 0.35], [radius, radius],
      [radius * 0.62, radius * 1.7], [0, radius * 1.95]], MATERIALS.berry, [0.85, 0.78, 0.75, 1], 8);
  }

  function pane(id, points, normal, alpha = 0.12) {
    const previous = target;
    target = emptyGeometry();
    quad(points, normal, MATERIALS.glass, [0.94, 0.98, 1, alpha]);
    quad(points, scale(normal, -1), MATERIALS.glass, [0.94, 0.98, 1, alpha]);
    const center = points.reduce((sum, point) => add(sum, scale(point, 1 / points.length)), [0, 0, 0]);
    transparent.push({ id, center, ...typedGeometry(target) });
    target = previous;
  }

  group('room-floor', true, () => {
    // Adjacent boards share Y=0; there is no raised floor hidden beneath the furniture.
    for (let column = 0; column < 20; column++) {
      const x = -4.4 + column * 0.44;
      const offset = column % 2 ? 0.275 : 0;
      for (let row = -1; row < 19; row++) {
        const z = Math.max(-7, -7 + row * 0.55 + offset);
        const Z = Math.min(3, -7 + (row + 1) * 0.55 + offset);
        if (Z <= z) continue;
        const tint = 0.90 + ((column * 7 + row * 3 + 21) % 7) * 0.012;
        quad([[x, 0, z], [x + 0.44, 0, z], [x + 0.44, 0, Z], [x, 0, Z]],
          [0, 1, 0], MATERIALS.wood, [tint, tint, tint, 1]);
      }
    }
  });

  group('room-shell', true, () => {
    box([-4.4, 0, -7], [4.4, 4.5, -6.84], MATERIALS.plaster);
    box([4.24, 0, -6.84], [4.4, 4.5, 3], MATERIALS.plaster, [0.96, 0.97, 0.94, 1]);
    box([-4.4, 0, -6.84], [-4.24, 4.5, -4.8], MATERIALS.plaster);
    box([-4.4, 0, -1.2], [-4.24, 4.5, 3], MATERIALS.plaster);
    box([-4.4, 0, -4.8], [-4.24, 1.3, -1.2], MATERIALS.plaster);
    box([-4.4, 3.8, -4.8], [-4.24, 4.5, -1.2], MATERIALS.plaster);
  });

  group('room-ceiling', false, () => {
    quad([[-4.4, 4.5, -7], [4.4, 4.5, -7], [4.4, 4.5, 3], [-4.4, 4.5, 3]],
      [0, -1, 0], MATERIALS.plaster);
  });

  group('window-casement', false, () => {
    quad([[-4.38, 1.3, -4.8], [-4.38, 3.8, -4.8], [-4.38, 3.8, -1.2], [-4.38, 1.3, -1.2]],
      [1, 0, 0], MATERIALS.window, [0.92, 0.96, 1, 1]);
    for (const z of [-4.8, -3.0, -1.2]) {
      bevelBox([-4.3, 1.25, z - 0.045], [-4.15, 3.85, z + 0.045], MATERIALS.wood, 0.016);
    }
    for (const y of [1.3, 2.55, 3.8]) {
      bevelBox([-4.3, y - 0.045, -4.86], [-4.13, y + 0.045, -1.14], MATERIALS.wood, 0.016);
    }
    bevelBox([-4.4, 1.22, -4.94], [-3.96, 1.3, -1.06], MATERIALS.stone, 0.025);
    landmarkPoints.windowCenter = [-4.38, 2.55, -3];
    landmarkPoints.windowOpeningMin = [-4.4, 1.3, -4.8];
    landmarkPoints.windowOpeningMax = [-4.24, 3.8, -1.2];
  });

  group('wainscoting', true, () => {
    for (let i = 0; i < 22; i++) {
      const x = -4.18 + i * 0.38;
      bevelBox([x, 0, -6.83], [x + 0.367, 1.14, -6.75], MATERIALS.wood, 0.012);
    }
    for (const x of [-4.23, 4.15]) {
      for (let i = 0; i < 24; i++) {
        const z = -6.72 + i * 0.4;
        box([x, 0, z], [x + 0.075, 1.14, z + 0.39], MATERIALS.wood);
      }
      bevelBox([x - 0.035, 1.13, -6.78], [x + 0.10, 1.22, 3], MATERIALS.darkWood, 0.015);
    }
    bevelBox([-4.23, 1.13, -6.79], [4.23, 1.22, -6.64], MATERIALS.darkWood, 0.02);
  });

  group('timber-frame', true, () => {
    for (const x of [-3.83, 3.65]) {
      bevelBox([x, 0, -6.7], [x + 0.18, 4.38, -6.48], MATERIALS.darkWood, 0.025);
    }
    for (const z of [-6.68, -3.48]) {
      bevelBox([-4.24, 4.22, z], [4.24, 4.5, z + 0.24], MATERIALS.darkWood, 0.025);
    }
    for (const x of [-4.18, 4.0]) {
      rod([x, 3.54, -3.34], [x < 0 ? x + 0.62 : x - 0.62, 4.22, -3.34], 0.055, MATERIALS.wood);
    }
    landmarkPoints.pendantBeamLeft = [-1.8, 4.22, -3.36];
    landmarkPoints.pendantBeamRight = [1.8, 4.22, -3.36];
  });

  group('back-counter', true, () => {
    box([-3.52, 0, -6.72], [3.52, 0.97, -5.88], MATERIALS.greenPaint);
    bevelBox([-3.58, 0.96, -6.77], [3.58, 1.07, -5.8], MATERIALS.wood, 0.035);
    box([-3.5, 0, -5.99], [3.5, 0.13, -5.86], MATERIALS.darkWood);
    for (const x of [-3.36, -2.38, 1.4, 2.38]) {
      bevelBox([x, 0.2, -5.90], [x + 0.9, 0.84, -5.83], MATERIALS.wood, 0.025);
      rod([x + 0.34, 0.75, -5.77], [x + 0.55, 0.75, -5.77], 0.022, MATERIALS.brass);
      for (const offset of [0.34, 0.55]) {
        rod([x + offset, 0.75, -5.84], [x + offset, 0.75, -5.77], 0.015, MATERIALS.brass);
      }
    }
    bevelBox([-1.22, 0.13, -5.94], [1.22, 0.94, -5.80], MATERIALS.stone, 0.04);
    bevelBox([-1.08, 0.23, -5.80], [1.08, 0.77, -5.75], MATERIALS.darkWood, 0.035);
    bevelBox([-0.89, 0.32, -5.75], [0.89, 0.65, -5.72], MATERIALS.stone, 0.025, [0.43, 0.45, 0.44, 1]);
    rod([-0.65, 0.81, -5.66], [0.65, 0.81, -5.66], 0.03, MATERIALS.brass);
    for (const x of [-0.65, 0.65]) rod([x, 0.81, -5.81], [x, 0.81, -5.66], 0.022, MATERIALS.brass);
    for (const x of [-0.87, 0.87]) {
      rod([x, 0.88, -5.81], [x, 0.88, -5.73], 0.042, MATERIALS.brass, WHITE, 12);
    }
    landmarkPoints.backCounterTop = [0, 1.07, -6.1];
  });

  function jar(x, y, z, radius, height, tint, lid = true) {
    lathe([x, y, z], [[0, 0], [radius * 0.72, 0], [radius, 0.04],
      [radius, height * 0.72], [radius * 0.76, height * 0.92], [radius * 0.76, height],
      [radius * 0.62, height], [radius * 0.62, height * 0.86], [0, height * 0.86]],
    MATERIALS.ceramic, tint, 16);
    if (lid) {
      lathe([x, y + height, z], [[0, 0], [radius * 0.82, 0], [radius * 0.84, 0.035],
        [radius * 0.64, 0.06], [0, 0.06]], MATERIALS.wood, WHITE, 16);
    }
  }

  function pitcher(x, y, z) {
    jar(x, y, z, 0.19, 0.43, [0.90, 0.95, 0.94, 1], false);
    const arc = [];
    for (let i = 0; i <= 7; i++) {
      const angle = -Math.PI / 2 + i / 7 * Math.PI;
      arc.push([x + 0.13 + Math.cos(angle) * 0.20, y + 0.23 + Math.sin(angle) * 0.145, z]);
    }
    for (let i = 0; i < arc.length - 1; i++) rod(arc[i], arc[i + 1], 0.028, MATERIALS.ceramic);
  }

  function loaf(x, y, z, yaw = 0, size = 1) {
    dome([x, y, z], 0.30 * size, 0.19 * size, MATERIALS.bread, WHITE, 16, [1.35, 0.68], yaw);
  }

  function scoredLoaf(x, y, z, yaw, size, round = false) {
    const rx = (round ? 0.22 : 0.34) * size, rz = 0.17 * size, h = 0.20 * size;
    dome([x, y, z], 0.25 * size, h, MATERIALS.bread, [0.96, 0.91 + size * 0.035, 0.84, 1],
      12, [rx / (0.25 * size), rz / (0.25 * size)], yaw);
    const point = (u, v) => [x + u * Math.cos(yaw) - v * Math.sin(yaw),
      y + h * Math.sqrt(Math.max(0, 1 - (u / rx) ** 2 - (v / rz) ** 2)),
      z + u * Math.sin(yaw) + v * Math.cos(yaw)];
    for (const offset of [-0.4, 0, 0.4]) {
      for (let i = 0; i < 3; i++) {
        const v = (i - 1.5) * rz * 0.32;
        rod(point(offset * rx + v * 0.3, v), point(offset * rx + (v + rz * 0.32) * 0.3, v + rz * 0.32),
          0.013 * size, MATERIALS.icing, [0.91, 0.81, 0.64, 1], 5);
      }
    }
  }

  function crescent(x, y, z, size, yaw) {
    const rings = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, a = -1.05 + t * 2.1;
      const r = (0.016 + Math.sin(t * Math.PI) * 0.067) * size;
      const center = [Math.sin(a) * 0.26 * size, r, (Math.cos(a) - 0.4) * 0.20 * size];
      const tangent = unit([Math.cos(a) * 0.26, 0, -Math.sin(a) * 0.20]);
      const side = cross(tangent, [0, 1, 0]);
      rings.push(Array.from({ length: 8 }, (_, j) => {
        const angle = j * TAU / 8;
        const p = add(center, add(scale(side, Math.cos(angle) * r), [0, Math.sin(angle) * r, 0]));
        return [x + p[0] * Math.cos(yaw) - p[2] * Math.sin(yaw), y + p[1],
          z + p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw)];
      }));
    }
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const k = (j + 1) % 8;
      triangle([rings[i][j], rings[i + 1][j], rings[i + 1][k]], MATERIALS.bread,
        i % 2 ? [1, 0.96, 0.88, 1] : [0.96, 0.90, 0.80, 1]);
      triangle([rings[i][j], rings[i + 1][k], rings[i][k]], MATERIALS.bread);
    }
    for (const [index, reverse] of [[0, false], [8, true]]) {
      const center = rings[index].reduce((sum, p) => add(sum, scale(p, 1 / 8)), [0, 0, 0]);
      for (let i = 0; i < 8; i++) {
        const points = [center, rings[index][i], rings[index][(i + 1) % 8]];
        triangle(reverse ? points.reverse() : points, MATERIALS.bread);
      }
    }
  }

  group('back-shelves', false, () => {
    for (const x of [-3.48, -1.04, 1.04, 3.36]) {
      bevelBox([x, 1.07, -6.69], [x + 0.1, 3.94, -6.20], MATERIALS.darkWood, 0.018);
    }
    for (const [left, right] of [[-3.54, -0.9], [0.94, 3.54]]) {
      box([left, 1.07, -6.735], [right, 3.94, -6.70], MATERIALS.darkWood, [0.80, 0.85, 0.91, 1]);
      bevelBox([left - 0.03, 3.87, -6.76], [right + 0.03, 4.01, -6.13], MATERIALS.wood, 0.024);
    }
    for (const y of [1.55, 2.34, 3.10]) {
      for (const [left, right] of [[-3.54, -0.9], [0.94, 3.54]]) {
        bevelBox([left, y - 0.085, -6.72], [right, y, -6.16], MATERIALS.wood, 0.022);
        for (const x of [left + 0.15, right - 0.15]) {
          rod([x, y - 0.30, -6.66], [x, y - 0.09, -6.20], 0.026, MATERIALS.darkWood);
        }
      }
    }
    jar(-3.08, 2.34, -6.42, 0.16, 0.38, [1, 0.94, 0.85, 1]);
    jar(-2.51, 2.34, -6.42, 0.20, 0.44, [0.87, 0.94, 0.93, 1]);
    jar(-1.85, 2.34, -6.42, 0.14, 0.31, [1, 0.94, 0.85, 1]);
    pitcher(1.49, 2.34, -6.42);
    jar(2.29, 2.34, -6.42, 0.18, 0.34, [0.92, 0.97, 0.88, 1]);
    jar(3.05, 3.10, -6.43, 0.19, 0.35, [1, 0.91, 0.82, 1]);
    jar(-2.66, 3.10, -6.43, 0.21, 0.40, [0.93, 0.95, 0.86, 1]);
    for (const x of [-2.95, -1.83, 1.46, 2.67]) loaf(x, 1.55, -6.40, 0.06, 0.86);
    jar(-2.81, 1.07, -6.26, 0.16, 0.31, [0.93, 0.92, 0.84, 1], false);
    for (let i = 0; i < 3; i++) {
      const start = [-2.9 + i * 0.08, 1.22, -6.26];
      const end = [-3.03 + i * 0.16, 1.76 + (i % 2) * 0.07, -6.25];
      rod(start, end, 0.017, MATERIALS.wood);
      dome(end, 0.045, 0.022, MATERIALS.wood, WHITE, 8, [0.72, 1]);
    }
    bevelBox([1.45, 1.07, -6.46], [2.71, 1.11, -5.99], MATERIALS.wood, 0.012);
    loaf(2.03, 1.11, -6.22, -0.08);
  });

  group('bread-alcove', false, () => {
    box([-0.88, 1.07, -6.73], [0.88, 3.69, -6.68], MATERIALS.darkWood, [0.84, 0.89, 0.95, 1]);
    for (const x of [-0.92, 0.83]) {
      bevelBox([x, 1.07, -6.71], [x + 0.09, 3.76, -6.12], MATERIALS.wood, 0.02);
    }
    for (const y of [1.48, 2.10, 2.72, 3.34]) {
      bevelBox([-0.94, y - 0.075, -6.73], [0.94, y, -6.10], MATERIALS.wood, 0.018);
    }
    bevelBox([-0.98, 3.69, -6.76], [0.98, 3.80, -6.08], MATERIALS.darkWood, 0.02);
    group('stocked-original-breads', false, () => {
      for (const [row, y] of [[0, 1.48], [1, 2.10], [2, 2.72], [3, 3.34]]) {
        for (const [column, x] of [[0, -0.51], [1, 0.06], [2, 0.59]]) {
          const size = 0.66 + ((row + column) % 3) * 0.065;
          if (row % 2) crescent(x, y, -6.39, size * 1.13, -0.18 + column * 0.14);
          else scoredLoaf(x, y, -6.40, -0.14 + column * 0.12, size, row === 2);
        }
      }
      for (const [x, y, size] of [[-3.11, 3.10, 0.63], [-1.63, 3.10, 0.69],
        [1.48, 3.10, 0.70], [2.19, 3.10, 0.61], [2.85, 2.34, 0.65]]) {
        scoredLoaf(x, y, -6.38, 0.10, size);
      }
      for (const [x, y] of [[-2.39, 1.55], [-1.30, 1.55], [2.07, 1.55], [3.17, 1.55]]) {
        dome([x, y, -6.33], 0.12, 0.13, MATERIALS.bread, [0.94, 0.87, 0.77, 1], 10);
      }
    });
    landmarkPoints.breadAlcoveShelf = [0, 2.72, -6.3];
  });

  group('counter-cabinet', true, () => {
    group('counter-footing', true, () => {
      box([-2.43, 0, -1.83], [2.43, 0.18, -0.51], MATERIALS.darkWood);
      for (const x of [-2.53, 2.35]) {
        for (const z of [-1.89, -0.63]) box([x, 0, z], [x + 0.18, 0.29, z + 0.18], MATERIALS.wood);
      }
    });
    box([-2.51, 0.16, -1.88], [2.51, 1.04, -0.47], MATERIALS.wood, [0.94, 0.93, 0.91, 1]);
    for (const x of [-2.36, -1.18, 0, 1.18]) {
      bevelBox([x, 0.27, -0.485], [x + 1.08, 0.89, -0.425], MATERIALS.wood, 0.02);
      bevelBox([x + 0.055, 0.325, -0.43], [x + 1.025, 0.835, -0.398], MATERIALS.greenPaint, 0.008);
    }
    bevelBox([-2.57, 0.17, -1.92], [2.57, 0.25, -0.41], MATERIALS.wood, 0.025);
    bevelBox([-2.61, 1.02, -1.97], [2.61, 1.13, -0.37], MATERIALS.wood, 0.035);
    landmarkPoints.counterFootLeft = [-2.53, 0, -0.45];
    landmarkPoints.counterFootRight = [2.53, 0, -0.45];
    landmarkPoints.counterFootingLeftContact = [-2.53, 0, -0.45];
    landmarkPoints.counterFootingRightContact = [2.53, 0, -0.45];
    landmarkPoints.counterFootingCenterContact = [0, 0, -1.17];
    landmarkPoints.counterTop = [0, 1.13, -0.75];
  });

  const lowerShelf = 1.25;
  const upperShelf = 1.67;
  group('glass-case', false, () => {
    for (const x of [-2.46, 2.42]) {
      for (const z of [-1.84, -0.54]) {
        bevelBox([x, 1.13, z], [x + 0.04, 2.10, z + 0.04], MATERIALS.brass, 0.006);
      }
    }
    bevelBox([-2.49, 2.065, -1.87], [2.49, 2.12, -1.78], MATERIALS.wood, 0.015);
    bevelBox([-2.49, 2.065, -0.59], [2.49, 2.12, -0.47], MATERIALS.wood, 0.015);
    for (const x of [-2.49, 2.40]) {
      bevelBox([x, 2.065, -1.85], [x + 0.09, 2.12, -0.5], MATERIALS.wood, 0.015);
    }
    bevelBox([-2.40, lowerShelf - 0.032, -1.81], [2.40, lowerShelf, -0.54], MATERIALS.ceramic, 0.009);
    bevelBox([-2.40, upperShelf - 0.026, -1.81], [2.40, upperShelf, -0.83], MATERIALS.ceramic, 0.007);
    for (const y of [lowerShelf - 0.045, upperShelf - 0.04]) {
      for (const x of [-2.43, 2.37]) box([x, y, -1.81], [x + 0.06, y + 0.025, -0.54], MATERIALS.brass);
    }
    for (const [left, right, suffix] of [[-2.42, 0, 'left'], [0, 2.42, 'right']]) {
      pane(`case-front-${suffix}`, [[left, 1.145, -0.518], [right, 1.145, -0.518],
        [right, 2.065, -0.518], [left, 2.065, -0.518]], [0, 0, 1], 0.10);
      pane(`case-back-${suffix}`, [[left, 1.145, -1.82], [right, 1.145, -1.82],
        [right, 2.065, -1.82], [left, 2.065, -1.82]], [0, 0, -1], 0.09);
    }
    for (const [x, name] of [[-2.44, 'left'], [2.44, 'right']]) {
      pane(`case-side-${name}`, [[x, 1.145, -1.80], [x, 1.145, -0.54],
        [x, 2.065, -0.54], [x, 2.065, -1.80]], [Math.sign(x), 0, 0], 0.12);
    }
    pane('case-top', [[-2.42, 2.084, -1.79], [2.42, 2.084, -1.79],
      [2.42, 2.084, -0.59], [-2.42, 2.084, -0.59]], [0, 1, 0], 0.10);
    landmarkPoints.lowerShelfTop = [0, lowerShelf, -0.95];
    landmarkPoints.upperShelfTop = [0, upperShelf, -1.31];
  });

  function plate(x, y, z, radius) {
    lathe([x, y, z], [[0, 0], [radius * 0.82, 0], [radius, 0.012],
      [radius, 0.024], [0, 0.024]], MATERIALS.ceramic, WHITE, 24);
    return y + 0.024;
  }

  function cakeBody(x, y, z, radius, height, material, tint = WHITE) {
    const bevel = Math.min(0.014, height / 3);
    lathe([x, y, z], [[0, 0], [radius - 0.013, 0], [radius, bevel],
      [radius, height - bevel], [radius - 0.012, height], [0, height]], material, tint, 24);
  }

  function piping(x, y, z, radius, count, color = WHITE) {
    for (let i = 0; i < count; i++) {
      const angle = i / count * TAU;
      dome([x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius], 0.031, 0.031,
        MATERIALS.icing, color, 8);
    }
  }

  group('display-cakes-lower', false, () => {
    const y = plate(-1.28, lowerShelf, -0.96, 0.435);
    group('cake-layered-cream', false, () => {
      cakeBody(-1.28, y, -0.96, 0.34, 0.235, MATERIALS.bread, [0.98, 0.95, 0.91, 1]);
      for (const height of [0.073, 0.157]) cakeBody(-1.28, y + height, -0.96, 0.345, 0.027, MATERIALS.icing);
      cakeBody(-1.28, y + 0.225, -0.96, 0.346, 0.028, MATERIALS.icing);
      piping(-1.28, y + 0.253, -0.96, 0.272, 10);
    });
    const rightY = plate(1.28, lowerShelf, -0.96, 0.43);
    group('cake-cocoa-rosettes', false, () => {
      cakeBody(1.28, rightY, -0.96, 0.34, 0.255, MATERIALS.chocolate);
      cakeBody(1.28, rightY + 0.125, -0.96, 0.343, 0.028, MATERIALS.icing, [0.95, 0.85, 0.72, 1]);
      piping(1.28, rightY + 0.255, -0.96, 0.257, 8, [0.97, 0.92, 0.83, 1]);
      for (const x of [1.12, 1.25, 1.38]) {
        box([x, rightY + 0.253, -1.04], [x + 0.07, rightY + 0.30, -0.93], MATERIALS.chocolate);
      }
    });
    const breadY = plate(0, lowerShelf, -1.04, 0.44);
    loaf(0, breadY, -0.92, -0.15, 0.68);
    loaf(0, breadY, -1.21, 0.12, 0.67);
    landmarkPoints.lowerCakeLeftBase = [-1.28, y, -0.96];
    landmarkPoints.lowerCakeRightBase = [1.28, rightY, -0.96];
    landmarkPoints.lowerCakeLeftContact = [-1.28 + 0.327, y, -0.96];
    landmarkPoints.lowerCakeRightContact = [1.28 + 0.327, rightY, -0.96];
    landmarkPoints.lowerPlateLeftBase = [-1.28, lowerShelf, -0.96];
    landmarkPoints.lowerPlateRightBase = [1.28, lowerShelf, -0.96];
    landmarkPoints.lowerCakeLeftTop = [-1.28, y + 0.284, -0.96];
    landmarkPoints.lowerCakeRightTop = [1.28, rightY + 0.30, -0.96];
  });

  group('display-cakes-upper', false, () => {
    const y = plate(-1.25, upperShelf, -1.31, 0.43);
    group('cake-berry-wreath', false, () => {
      cakeBody(-1.25, y, -1.31, 0.327, 0.23, MATERIALS.icing);
      cakeBody(-1.25, y + 0.22, -1.31, 0.23, 0.058, MATERIALS.icing, [1, 0.96, 0.90, 1]);
      piping(-1.25, y, -1.31, 0.316, 12);
      for (let i = 0; i < 6; i++) {
        const angle = i / 6 * TAU;
        berry([-1.25 + Math.cos(angle) * 0.165, y + 0.278, -1.31 + Math.sin(angle) * 0.165], 0.038);
      }
    });
    const rightY = plate(1.25, upperShelf, -1.31, 0.43);
    group('cake-golden-ring', false, () => {
      lathe([1.25, rightY, -1.31], [[0.12, 0], [0.28, 0], [0.335, 0.06],
        [0.32, 0.16], [0.265, 0.25], [0.19, 0.275], [0.12, 0.22], [0.10, 0.08], [0.12, 0]],
      MATERIALS.bread, [1, 0.94, 0.87, 1], 24);
      lathe([1.25, rightY + 0.239, -1.31], [[0.165, 0], [0.255, 0],
        [0.249, 0.018], [0.18, 0.036], [0.147, 0.019], [0.165, 0]], MATERIALS.icing, WHITE, 24);
    });
    landmarkPoints.upperCakeLeftBase = [-1.25, y, -1.31];
    landmarkPoints.upperCakeRightBase = [1.25, rightY, -1.31];
    landmarkPoints.upperCakeLeftContact = [-1.25 + 0.314, y, -1.31];
    landmarkPoints.upperCakeRightContact = [1.25 + 0.28, rightY, -1.31];
    landmarkPoints.upperPlateLeftBase = [-1.25, upperShelf, -1.31];
    landmarkPoints.upperPlateRightBase = [1.25, upperShelf, -1.31];
    landmarkPoints.upperCakeLeftTop = [-1.25, y + 0.3521, -1.31];
    landmarkPoints.upperCakeRightTop = [1.25, rightY + 0.275, -1.31];
  });

  group('side-prep-table', true, () => {
    for (const x of [-3.91, -3.10]) {
      for (const z of [0.19, 0.94]) {
        box([x, 0, z], [x + 0.105, 1.04, z + 0.105], MATERIALS.wood);
      }
    }
    for (const x of [-3.87, -3.055]) box([x, 0.29, 0.25], [x + 0.065, 0.36, 1], MATERIALS.darkWood);
    bevelBox([-4.02, 1.02, 0.08], [-2.87, 1.14, 1.15], MATERIALS.wood, 0.028);
    box([-3.81, 1.14, 0.22], [-3.03, 1.15, 0.95], MATERIALS.linen);
    lathe([-3.46, 1.15, 0.60], [[0, 0], [0.13, 0], [0.24, 0.16], [0.27, 0.23],
      [0.245, 0.23], [0.21, 0.16], [0.11, 0.035], [0, 0.035]], MATERIALS.ceramic, [0.91, 0.96, 0.95, 1], 20);
    rod([-3.76, 1.16, 0.29], [-3.15, 1.16, 0.29], 0.038, MATERIALS.wood);
    landmarkPoints.prepTableFoot = [-3.91, 0, 0.19];
  });

  function leaf(start, end, width, twist) {
    const direction = unit(subtract(end, start));
    const side = unit(cross(direction, [Math.cos(twist), 0.35, Math.sin(twist)]));
    const middle = add(start, scale(subtract(end, start), 0.52));
    const left = add(middle, scale(side, width));
    const right = add(middle, scale(side, -width));
    const ridge = add(middle, [0, 0.034, 0]);
    for (const points of [[start, left, ridge], [left, end, ridge], [end, right, ridge], [right, start, ridge]]) {
      triangle(points, MATERIALS.leaf, [0.87, 0.95, 0.82, 1]);
      triangle([...points].reverse(), MATERIALS.leaf, [0.79, 0.89, 0.74, 1]);
    }
  }

  group('floor-plant', true, () => {
    lathe([3.46, 0, -0.66], [[0, 0], [0.25, 0], [0.28, 0.05], [0.36, 0.54],
      [0.375, 0.55], [0.375, 0.61], [0.33, 0.61], [0.31, 0.50], [0, 0.50]],
    MATERIALS.ceramic, [0.90, 0.80, 0.67, 1], 20);
    cylinder([3.46, 0.505, -0.66], 0.31, 0.01, MATERIALS.darkWood);
    for (let i = 0; i < 7; i++) {
      const angle = i / 7 * TAU + 0.2;
      const height = 1.13 + (i % 3) * 0.17;
      const start = [3.46, 0.515, -0.66];
      const end = [3.46 + Math.cos(angle) * 0.20, height, -0.66 + Math.sin(angle) * 0.20];
      rod(start, end, 0.012, MATERIALS.leaf, WHITE, 6);
      for (const fraction of [0.56, 0.88]) {
        const join = add(start, scale(subtract(end, start), fraction));
        const tip = add(join, [Math.cos(angle) * 0.32, 0.15, Math.sin(angle) * 0.32]);
        leaf(join, tip, 0.105, angle + 0.8);
      }
    }
    landmarkPoints.plantPotBase = [3.46, 0, -0.66];
  });

  group('pendants', false, () => {
    for (const [x, y] of [[-1.8, 2.91], [1.8, 3.04]]) {
      rod([x, y + 0.36, -3.36], [x, 4.22, -3.36], 0.015, MATERIALS.darkWood);
      lathe([x, y, -3.36], [[0.37, 0], [0.39, 0.025], [0.32, 0.12],
        [0.15, 0.31], [0.09, 0.38], [0, 0.38]], MATERIALS.greenPaint, [0.93, 0.96, 0.88, 1], 24);
      lathe([x, y, -3.36], [[0, 0.045], [0.335, 0.045], [0.12, 0.30], [0, 0.30]],
        MATERIALS.window, [1, 0.79, 0.47, 1], 20);
    }
  });

  landmarkPoints.floorCenter = [0, 0, 0];
  landmarkPoints.backWallCenter = [0, 2.25, -6.84];
  landmarkPoints.roomFrontLeft = [-4.4, 0, 3];
  landmarkPoints.roomFrontRight = [4.4, 0, 3];
  return { opaque: typedGeometry(opaque), transparent, groups, bounds, landmarkPoints };
}
