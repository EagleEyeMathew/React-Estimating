import type { Vec2, Vec3 } from './types.js';
import { EPS, quantise } from './num.js';

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D cross product (z of the 3D cross). Positive when b is left of a. */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
export const dist2 = (a: Vec2, b: Vec2): number => (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
/** Removes negative zero, which would otherwise make JSON output run-dependent. */
const nz = (v: number): number => (v === 0 ? 0 : v);

/** Left-hand normal of a vector. */
export const perp = (a: Vec2): Vec2 => ({ x: nz(-a.y), y: nz(a.x) });

export function normalise(a: Vec2): Vec2 {
  const l = len(a);
  if (l < EPS) throw new RangeError('cannot normalise a zero-length vector');
  return { x: a.x / l, y: a.y / l };
}

export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function equals(a: Vec2, b: Vec2, eps = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** Unit vector for an angle in radians, measured CCW from +X. */
export function fromAngle(theta: number): Vec2 {
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

/** Angle of a vector in radians, in (-PI, PI]. */
export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

export function rotate(a: Vec2, theta: number): Vec2 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const q2 = (a: Vec2): Vec2 => ({ x: quantise(a.x), y: quantise(a.y) });
export const q3 = (a: Vec3): Vec3 => ({ x: quantise(a.x), y: quantise(a.y), z: quantise(a.z) });

/** Distance from `p` to the segment `a`-`b`, and the closest point on it. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; distance: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS * EPS) return { point: a, distance: dist(p, a), t: 0 };
  let t = dot(sub(p, a), ab) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const point = add(a, scale(ab, t));
  return { point, distance: dist(p, point), t };
}
