/** Small, allocation-free math helpers shared by every system. */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const lerp = (a, b, t) => a + (b - a) * t;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent smoothing factor.
 * `value += (target - value) * dampFactor(lambda, dt)` converges at the same
 * speed at 30, 60 or 144 fps.
 */
export const dampFactor = (lambda, dt) => 1 - Math.exp(-lambda * dt);

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(a) {
  const TWO_PI = Math.PI * 2;
  a = (a + Math.PI) % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a - Math.PI;
}

/** Interpolates between two angles along the shortest arc. */
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
