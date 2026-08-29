import type { MultiPolygon, Polygon, Ring } from './types.js';
import { booleanOp } from './clipper.js';
import { normalisePolygon } from './polygon.js';

export const union = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => booleanOp('union', a, b);
export const difference = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => booleanOp('difference', a, b);
export const intersection = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => booleanOp('intersection', a, b);
export const symmetricDifference = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => booleanOp('xor', a, b);

export function unionAll(parts: readonly MultiPolygon[]): MultiPolygon {
  if (parts.length === 0) return [];
  return parts.reduce((acc, p) => (acc.length === 0 ? p.map(normalisePolygon) : union(acc, p)));
}

export function differenceAll(base: MultiPolygon, subtract: readonly MultiPolygon[]): MultiPolygon {
  if (subtract.length === 0) return base.map(normalisePolygon);
  return difference(base, unionAll(subtract));
}

/**
 * The workable ceiling area: the boundary less its holes less anything else that
 * must not be built through (columns, voids, penetrations that are cut around).
 */
export function workableRegion(
  boundary: Ring,
  holes: readonly Ring[],
  obstructions: readonly Ring[] = [],
): MultiPolygon {
  const base: Polygon[] = [normalisePolygon({ outer: boundary, holes })];
  if (obstructions.length === 0) return base;
  return difference(base, obstructions.map((o) => normalisePolygon({ outer: o, holes: [] })));
}
