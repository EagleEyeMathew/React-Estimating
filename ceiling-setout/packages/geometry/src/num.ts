/**
 * Deterministic numeric helpers.
 *
 * Setout dimensions must be reproducible byte-for-byte across runs and machines, so
 * every value that reaches a member, a dimension or a schedule passes through
 * {@link quantise}. The working resolution is 1 micron, far finer than anything a
 * ceiling is ever set out to, but coarse enough to absorb floating point drift from
 * rotation and projection.
 */

/** Working resolution in mm. */
export const RESOLUTION = 1e-3;

/** Comparison tolerance in mm for exact algebraic tests (orientation, degeneracy). */
export const EPS = 1e-6;

/**
 * Geometric tolerance in mm for containment and coincidence tests.
 *
 * Deliberately an order of magnitude coarser than {@link RESOLUTION}: quantising a
 * point can move it by half a resolution unit, and a clipped member's endpoint sits
 * exactly on the boundary it was clipped against. Testing that endpoint against a
 * tolerance finer than the grid it was snapped to reports it as outside the region it
 * demonstrably came from. 10 microns is still a thousand times finer than any
 * dimension a ceiling is set out to.
 */
export const TOLERANCE = 1e-2;

/** Snap a value to the working resolution. Removes -0 so JSON output is stable. */
export function quantise(v: number): number {
  if (!Number.isFinite(v)) throw new RangeError(`non-finite value: ${v}`);
  const q = Math.round(v / RESOLUTION) * RESOLUTION;
  const r = Number(q.toFixed(6));
  return r === 0 ? 0 : r;
}

/** Round to a given number of decimal places, deterministically. */
export function round(v: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round(v * f + (v >= 0 ? Number.EPSILON : -Number.EPSILON)) / f;
  return r === 0 ? 0 : r;
}

export function approxEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Number of equal divisions needed so that no division exceeds `maxSpacing`.
 * Used everywhere a span is subdivided: it keeps actual spacing at or under the
 * rule value while distributing members evenly rather than leaving a short last bay.
 */
export function divisionsForMaxSpacing(length: number, maxSpacing: number): number {
  if (maxSpacing <= 0) throw new RangeError('maxSpacing must be > 0');
  if (length <= maxSpacing) return 1;
  return Math.ceil(length / maxSpacing - 1e-9);
}
