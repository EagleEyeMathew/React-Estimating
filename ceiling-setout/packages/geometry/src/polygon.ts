import type { Box, MultiPolygon, Polygon, Ring, Vec2 } from './types.js';
import { EPS } from './num.js';
import { area, bbox, centroid, cleanRing, isSimple, signedArea, toCCW, toCW, unionBox } from './ring.js';

export function polygon(outer: Ring, holes: readonly Ring[] = []): Polygon {
  return normalisePolygon({ outer, holes });
}

/**
 * Canonical form: outer ring CCW, holes CW, no duplicate or collinear vertices,
 * all coordinates quantised. Every algorithm in this package assumes this form.
 */
export function normalisePolygon(p: Polygon): Polygon {
  const outer = toCCW(cleanRing(p.outer));
  const holes = p.holes
    .map((h) => toCW(cleanRing(h)))
    .filter((h) => h.length >= 3 && area(h) > EPS);
  return { outer, holes };
}

export const polygonArea = (p: Polygon): number =>
  area(p.outer) - p.holes.reduce((s, h) => s + area(h), 0);

export function polygonBBox(p: Polygon): Box {
  return bbox(p.outer);
}

export function multiPolygonBBox(mp: MultiPolygon): Box {
  const boxes = mp.filter((p) => p.outer.length >= 3).map(polygonBBox);
  if (boxes.length === 0) throw new RangeError('empty multipolygon has no bounding box');
  return boxes.reduce(unionBox);
}

export const multiPolygonArea = (mp: MultiPolygon): number =>
  mp.reduce((s, p) => s + polygonArea(p), 0);

export const polygonCentroid = (p: Polygon): Vec2 => centroid(p.outer);

export function allRings(p: Polygon): Ring[] {
  return [p.outer, ...p.holes];
}

export interface PolygonProblem {
  readonly code:
    | 'TOO_FEW_VERTICES'
    | 'ZERO_AREA'
    | 'SELF_INTERSECTING'
    | 'HOLE_TOO_FEW_VERTICES'
    | 'HOLE_SELF_INTERSECTING'
    | 'HOLE_OUTSIDE_OUTER';
  readonly message: string;
  readonly ringIndex: number;
}

/**
 * Structural validation. Deliberately separate from normalisation: a boundary the
 * user has drawn badly must produce a reported problem, never a silently repaired
 * polygon that generates a plausible-looking but wrong setout.
 */
export function validatePolygon(p: Polygon): PolygonProblem[] {
  const problems: PolygonProblem[] = [];
  if (p.outer.length < 3) {
    problems.push({ code: 'TOO_FEW_VERTICES', message: 'boundary needs at least 3 vertices', ringIndex: 0 });
    return problems;
  }
  if (area(p.outer) <= EPS) {
    problems.push({ code: 'ZERO_AREA', message: 'boundary encloses no area', ringIndex: 0 });
  }
  if (!isSimple(p.outer)) {
    problems.push({ code: 'SELF_INTERSECTING', message: 'boundary crosses itself', ringIndex: 0 });
  }
  p.holes.forEach((h, i) => {
    const ringIndex = i + 1;
    if (h.length < 3) {
      problems.push({ code: 'HOLE_TOO_FEW_VERTICES', message: `hole ${i} needs at least 3 vertices`, ringIndex });
      return;
    }
    if (!isSimple(h)) {
      problems.push({ code: 'HOLE_SELF_INTERSECTING', message: `hole ${i} crosses itself`, ringIndex });
    }
  });
  return problems;
}

/** Convenience for tests and fixtures: a rectangle from two corners. */
export function rectangle(x0: number, y0: number, x1: number, y1: number): Ring {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Convenience for tests and fixtures: a regular polygon approximating a circle. */
export function circle(centre: Vec2, radius: number, segments = 32): Ring {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    pts.push({ x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) });
  }
  return pts;
}

export { signedArea };
