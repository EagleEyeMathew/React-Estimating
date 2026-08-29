import type { Arc, BoundaryEdge, BoundaryPath, Ring, Vec2 } from './types.js';
import { EPS, quantise } from './num.js';
import { dist, sub, angleOf } from './vec.js';

export const arcRadius = (a: Arc): number => dist(a.centre, a.start);

/** Swept angle in radians, always positive, in the direction given by `ccw`. */
export function arcSweep(a: Arc): number {
  const t0 = angleOf(sub(a.start, a.centre));
  const t1 = angleOf(sub(a.end, a.centre));
  let d = t1 - t0;
  if (a.ccw) {
    while (d <= 0) d += 2 * Math.PI;
  } else {
    while (d >= 0) d -= 2 * Math.PI;
    d = -d;
  }
  return d;
}

export const arcLength = (a: Arc): number => arcRadius(a) * arcSweep(a);

/**
 * Number of chords needed to keep the mid-chord deviation within `chordTolerance`.
 *
 * The tolerance is recorded on the boundary rather than baked in, because the
 * tessellation is only a working approximation: the drawing package dimensions back
 * to the true arc, so this value affects the setout, not the documented geometry.
 */
export function arcSegmentCount(a: Arc, chordTolerance: number): number {
  const r = arcRadius(a);
  const sweep = arcSweep(a);
  if (r <= EPS || sweep <= EPS) return 1;
  if (chordTolerance <= 0 || chordTolerance >= r) return Math.max(1, Math.ceil(sweep / (Math.PI / 8)));
  const maxAngle = 2 * Math.acos(1 - chordTolerance / r);
  return Math.max(1, Math.ceil(sweep / maxAngle - 1e-9));
}

/** Tessellate an arc, excluding its end point (rings join edge to edge). */
export function tessellateArc(a: Arc, chordTolerance: number): Vec2[] {
  const r = arcRadius(a);
  const sweep = arcSweep(a);
  const n = arcSegmentCount(a, chordTolerance);
  const t0 = angleOf(sub(a.start, a.centre));
  const sign = a.ccw ? 1 : -1;
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + sign * (sweep * i) / n;
    pts.push({ x: quantise(a.centre.x + r * Math.cos(t)), y: quantise(a.centre.y + r * Math.sin(t)) });
  }
  return pts;
}

export function tessellateEdge(e: BoundaryEdge, chordTolerance: number): Vec2[] {
  return e.kind === 'line' ? [{ x: quantise(e.start.x), y: quantise(e.start.y) }] : tessellateArc(e, chordTolerance);
}

/** Flatten a true-edge boundary into a ring for generation. */
export function boundaryToRing(path: BoundaryPath): Ring {
  return path.edges.flatMap((e) => tessellateEdge(e, path.chordTolerance));
}

/** The straight-edge boundary equivalent to a ring, for round-tripping. */
export function ringToBoundary(ring: Ring, chordTolerance = 1): BoundaryPath {
  const edges: BoundaryEdge[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    edges.push({ kind: 'line', start: ring[i]!, end: ring[(i + 1) % n]! });
  }
  return { edges, chordTolerance };
}

/**
 * Which true edge a point lies on, if any. Lets a dimension generated against the
 * tessellation be reported against the arc it actually belongs to.
 */
export function edgeAt(path: BoundaryPath, p: Vec2, tolerance = 1): number | null {
  for (let i = 0; i < path.edges.length; i++) {
    const e = path.edges[i]!;
    if (e.kind === 'arc') {
      const r = arcRadius(e);
      if (Math.abs(dist(e.centre, p) - r) <= tolerance) return i;
    } else {
      const d = pointToSegmentDistance(p, e.start, e.end);
      if (d <= tolerance) return i;
    }
  }
  return null;
}

function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < EPS) return dist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}
