import type { MultiPolygon, Polygon, Ring, Segment, Vec2 } from './types.js';
import { EPS, TOLERANCE } from './num.js';
import { closestPointOnSegment, dist } from './vec.js';
import { clipSegment } from './clipper.js';
import { allRings } from './polygon.js';

export type Containment = 'inside' | 'outside' | 'boundary';

/**
 * Point-in-ring by crossing number, with an explicit boundary result.
 *
 * The boundary case is tested first and by distance, not by the crossing rule, so a
 * vertex that lies exactly on an edge is reported as `boundary` instead of falling
 * arbitrarily one side or the other. Setout points routinely land exactly on walls
 * and hole edges, so this case is the common one, not a curiosity.
 */
export function pointInRing(p: Vec2, ring: Ring, tolerance = TOLERANCE): Containment {
  const n = ring.length;
  if (n < 3) return 'outside';
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (closestPointOnSegment(p, a, b).distance <= tolerance) return 'boundary';
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const t = (p.y - a.y) / (b.y - a.y);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

export function pointInPolygon(p: Vec2, poly: Polygon, tolerance = TOLERANCE): Containment {
  const outer = pointInRing(p, poly.outer, tolerance);
  if (outer === 'outside') return 'outside';
  if (outer === 'boundary') return 'boundary';
  for (const h of poly.holes) {
    const c = pointInRing(p, h, tolerance);
    if (c === 'inside') return 'outside';
    if (c === 'boundary') return 'boundary';
  }
  return 'inside';
}

export function pointInMultiPolygon(p: Vec2, mp: MultiPolygon, tolerance = TOLERANCE): Containment {
  let boundary = false;
  for (const poly of mp) {
    const c = pointInPolygon(p, poly, tolerance);
    if (c === 'inside') return 'inside';
    if (c === 'boundary') boundary = true;
  }
  return boundary ? 'boundary' : 'outside';
}

export const isPointInside = (p: Vec2, mp: MultiPolygon, tolerance = TOLERANCE): boolean =>
  pointInMultiPolygon(p, mp, tolerance) !== 'outside';

export const segmentLength = (s: Segment): number => dist(s.a, s.b);

/**
 * How far a segment strays outside a region, measured as penetration depth in mm.
 *
 * Depth, not length, is the meaningful measure. Clipping a line that meets a boundary
 * at a shallow angle rounds the intersection point perpendicular to that boundary by
 * up to half a resolution unit, which shifts it *along* the line by that error
 * divided by the sine of the crossing angle. A member tangent to a column therefore
 * shows a long overlap with a penetration depth of a few microns. Judging it by
 * overlap length calls a graze a collision; judging it by depth does not, while a
 * member that genuinely runs through the column reports a depth of hundreds of mm.
 */
/** Always even, so the midpoint - where penetration is deepest - is always sampled. */
function sampleCount(span: number): number {
  const n = Math.min(24, Math.max(4, Math.ceil(span / 50) + 2));
  return n % 2 === 0 ? n : n + 1;
}

export function excursionDepth(seg: Segment, mp: MultiPolygon): number {
  const total = segmentLength(seg);
  if (total <= EPS) return isPointInside(seg.a, mp) ? 0 : distanceToBoundary(seg.a, mp);
  const u = { x: (seg.b.x - seg.a.x) / total, y: (seg.b.y - seg.a.y) / total };
  const at = (t: number): Vec2 => ({ x: seg.a.x + u.x * t, y: seg.a.y + u.y * t });

  // Parameter intervals of the segment that fall inside the region.
  const inside = clipSegment(seg, mp)
    .map((c) => {
      const t0 = (c.a.x - seg.a.x) * u.x + (c.a.y - seg.a.y) * u.y;
      const t1 = (c.b.x - seg.a.x) * u.x + (c.b.y - seg.a.y) * u.y;
      return t0 <= t1 ? { t0, t1 } : { t0: t1, t1: t0 };
    })
    .sort((a, b) => a.t0 - b.t0);

  // The complement of those intervals is where the segment is outside.
  const outside: { t0: number; t1: number }[] = [];
  let cursor = 0;
  for (const i of inside) {
    if (i.t0 > cursor) outside.push({ t0: cursor, t1: i.t0 });
    cursor = Math.max(cursor, i.t1);
  }
  if (cursor < total) outside.push({ t0: cursor, t1: total });

  let depth = 0;
  for (const o of outside) {
    const span = o.t1 - o.t0;
    if (span <= EPS) continue;
    const samples = sampleCount(span);
    for (let i = 0; i <= samples; i++) {
      const p = at(o.t0 + (span * i) / samples);
      if (pointInMultiPolygon(p, mp) !== 'outside') continue;
      const d = distanceToBoundary(p, mp);
      if (d > depth) depth = d;
    }
  }
  return depth;
}

/**
 * True when the whole segment lies within the region (boundary contact allowed).
 *
 * Decided by clipping rather than by sampling alone: a member that ducks out of the
 * zone and back in - across a re-entrant corner or a column - must fail, and a plain
 * sample can step straight over a narrow excursion.
 */
export function isSegmentInside(seg: Segment, mp: MultiPolygon, tolerance = TOLERANCE): boolean {
  return excursionDepth(seg, mp) <= tolerance;
}

/** All holes of a region, as polygons in their own right. */
function holePolygons(mp: MultiPolygon): Polygon[] {
  const holes: Polygon[] = [];
  for (const poly of mp) for (const h of poly.holes) holes.push({ outer: h, holes: [] });
  return holes;
}

/**
 * How far a segment penetrates any hole of the region, in mm. Zero when it merely
 * touches or grazes one.
 */
export function holePenetrationDepth(seg: Segment, mp: MultiPolygon): number {
  const holes = holePolygons(mp);
  let depth = 0;
  for (const hole of holes) {
    const region = [hole];
    for (const piece of clipSegment(seg, region)) {
      const span = segmentLength(piece);
      if (span <= EPS) continue;
      const samples = sampleCount(span);
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const p = { x: piece.a.x + (piece.b.x - piece.a.x) * t, y: piece.a.y + (piece.b.y - piece.a.y) * t };
        if (pointInPolygon(p, hole) !== 'inside') continue;
        const d = distanceToBoundary(p, region);
        if (d > depth) depth = d;
      }
    }
  }
  return depth;
}

/** True when the segment passes through a hole of the region rather than grazing it. */
export function segmentCrossesHole(seg: Segment, mp: MultiPolygon, tolerance = TOLERANCE): boolean {
  return holePenetrationDepth(seg, mp) > tolerance;
}

/** Nearest point on any ring edge of the region, with its distance. */
export function nearestBoundaryPoint(p: Vec2, mp: MultiPolygon): { point: Vec2 | null; distance: number } {
  let best = Infinity;
  let point: Vec2 | null = null;
  for (const poly of mp) {
    for (const ring of allRings(poly)) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const c = closestPointOnSegment(p, ring[i]!, ring[(i + 1) % n]!);
        if (c.distance < best) {
          best = c.distance;
          point = c.point;
        }
      }
    }
  }
  return { point, distance: best };
}

/** Shortest distance from a point to any ring edge in the region. */
export function distanceToBoundary(p: Vec2, mp: MultiPolygon): number {
  return nearestBoundaryPoint(p, mp).distance;
}

/** Shortest distance from a point to the nearest of a set of segments. */
export function distanceToNearestSegment(p: Vec2, segments: readonly Segment[]): number {
  let best = Infinity;
  for (const s of segments) {
    const d = closestPointOnSegment(p, s.a, s.b).distance;
    if (d < best) best = d;
  }
  return best;
}
