import type { Box, Ring, Vec2 } from './types.js';
import { EPS, quantise } from './num.js';
import { dist, sub, cross, add, scale } from './vec.js';

/** Signed area. Positive = counter-clockwise. */
export function signedArea(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (ring: Ring): number => Math.abs(signedArea(ring));
export const isCCW = (ring: Ring): boolean => signedArea(ring) > 0;

export function perimeter(ring: Ring): number {
  const n = ring.length;
  let p = 0;
  for (let i = 0; i < n; i++) p += dist(ring[i]!, ring[(i + 1) % n]!);
  return p;
}

export function bbox(ring: Ring): Box {
  if (ring.length === 0) throw new RangeError('empty ring has no bounding box');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Area-weighted centroid. Falls back to the vertex mean for degenerate rings. */
export function centroid(ring: Ring): Vec2 {
  const n = ring.length;
  const a = signedArea(ring);
  if (Math.abs(a) < EPS) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export const reverse = (ring: Ring): Ring => [...ring].reverse();
export const toCCW = (ring: Ring): Ring => (isCCW(ring) ? ring : reverse(ring));
export const toCW = (ring: Ring): Ring => (isCCW(ring) ? reverse(ring) : ring);

/** Drop a repeated closing vertex, duplicate points and exactly-collinear vertices. */
export function cleanRing(ring: Ring, eps = EPS): Ring {
  const pts: Vec2[] = [];
  for (const p of ring) {
    const last = pts[pts.length - 1];
    if (last && dist(last, p) <= eps) continue;
    pts.push({ x: quantise(p.x), y: quantise(p.y) });
  }
  while (pts.length > 1 && dist(pts[0]!, pts[pts.length - 1]!) <= eps) pts.pop();
  if (pts.length < 3) return pts;
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const c = cross(sub(cur, prev), sub(next, cur));
    // Scale the collinearity test by edge length so it stays a distance test.
    const scaleLen = Math.max(dist(prev, cur), dist(cur, next), 1);
    if (Math.abs(c) / scaleLen > eps) out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

export interface RingEdge {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly index: number;
  readonly length: number;
}

export function edges(ring: Ring): RingEdge[] {
  const n = ring.length;
  const out: RingEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    out.push({ a, b, index: i, length: dist(a, b) });
  }
  return out;
}

/** Longest edge of the ring. Ties resolve to the lowest index, so it is deterministic. */
export function longestEdge(ring: Ring): RingEdge {
  const es = edges(ring);
  if (es.length === 0) throw new RangeError('ring has no edges');
  let best = es[0]!;
  for (const e of es) if (e.length > best.length + EPS) best = e;
  return best;
}

/** True if the ring has no self-intersections (ignoring shared endpoints of adjacent edges). */
export function isSimple(ring: Ring): boolean {
  const es = edges(ring);
  const n = es.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsProperlyIntersect(es[i]!.a, es[i]!.b, es[j]!.a, es[j]!.b)) return false;
    }
  }
  return true;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  const d = cross(sub(b, a), sub(c, a));
  const s = Math.max(dist(a, b), dist(a, c), 1);
  const v = d / s;
  return Math.abs(v) <= EPS ? 0 : Math.sign(v);
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    orient(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

export function segmentsProperlyIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/**
 * Principal axis of a ring, by the covariance of its area. Used as the fallback
 * setout direction when the user has not nominated one and there is no dominant wall.
 */
export function principalAxis(ring: Ring): Vec2 {
  const c = centroid(ring);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let total = 0;
  // Weight each edge midpoint by edge length: robust for both fat and thin shapes.
  for (const e of edges(ring)) {
    const m = scale(add(e.a, e.b), 0.5);
    const w = e.length;
    const dx = m.x - c.x;
    const dy = m.y - c.y;
    sxx += w * dx * dx;
    syy += w * dy * dy;
    sxy += w * dx * dy;
    total += w;
  }
  if (total < EPS) return { x: 1, y: 0 };
  sxx /= total;
  syy /= total;
  sxy /= total;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}
