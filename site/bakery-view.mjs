export function multiplyMatrices(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return result;
}

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalized(vector) {
  const length = Math.hypot(...vector);
  if (!length || !Number.isFinite(length)) throw new RangeError('Finite nonzero view direction required.');
  return vector.map(value => value / length);
}

export function lookAt(eye, target) {
  const z = normalized(eye.map((value, index) => value - target[index]));
  const x = normalized(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function bakeryView(width, height, lookX = 0, lookY = 0) {
  if (![width, height, lookX, lookY].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RangeError('Positive view dimensions and finite look coordinates required.');
  }
  const x = Math.max(-1, Math.min(1, lookX)), y = Math.max(-1, Math.min(1, lookY));
  const eye = [x * 1.05, 2.4 - y * .22, 6.4];
  const target = [x * 1.45, 1.25 - y * 1.05, -2.5];
  const aspect = width / height;
  const fy = Math.min(1 / Math.tan(17 * Math.PI / 180),
    Math.max(aspect / Math.tan(Math.PI / 6), 1 / Math.tan(29 * Math.PI / 180)));
  const near = .1, far = 40;
  const projection = new Float32Array([
    fy / aspect, 0, 0, 0, 0, fy, 0, 0,
    0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0,
  ]);
  return { eye, target, matrix: multiplyMatrices(projection, lookAt(eye, target)) };
}

export function bakeryLight() {
  const eye = [-7, 4.7, -3.8], target = [0, 2.5, -2];
  const near = .1, far = 24;
  const projection = new Float32Array([
    1 / 9, 0, 0, 0, 0, 1 / 8, 0, 0, 0, 0, -2 / (far - near), 0,
    0, 0, -(far + near) / (far - near), 1,
  ]);
  return {
    direction: normalized(eye.map((value, index) => value - target[index])),
    matrix: multiplyMatrices(projection, lookAt(eye, target)),
  };
}

export function projectPoint(matrix, point, width, height) {
  const input = [...point, 1], clip = new Array(4).fill(0);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) clip[row] += matrix[col * 4 + row] * input[col];
  if (!Number.isFinite(clip[3]) || Math.abs(clip[3]) < 1e-8) throw new RangeError('Point lies on the projection plane.');
  return { x: (clip[0] / clip[3] + 1) * width / 2, y: (1 - clip[1] / clip[3]) * height / 2, depth: clip[2] / clip[3], visible: clip[3] > 0 };
}
