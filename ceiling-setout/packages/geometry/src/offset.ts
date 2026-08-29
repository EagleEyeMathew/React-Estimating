import type { MultiPolygon } from './types.js';
import { offsetMultiPolygon, type JoinStyle } from './clipper.js';
import { multiPolygonArea } from './polygon.js';
import { EPS } from './num.js';

export type { JoinStyle };

/** Grow a polygon set outwards by `distance` mm. */
export function outset(mp: MultiPolygon, distance: number, join: JoinStyle = 'miter'): MultiPolygon {
  if (distance < 0) throw new RangeError('outset distance must be >= 0');
  return offsetMultiPolygon(mp, distance, join);
}

/**
 * Shrink a polygon set inwards by `distance` mm.
 *
 * This is what perimeter setback rules resolve to ("first member no more than X from
 * the wall" implies the member family must start within X of every wall). Reflex
 * corners collapse correctly and narrow necks disappear entirely, which is the
 * honest answer: there is no room for a member there.
 */
export function inset(mp: MultiPolygon, distance: number, join: JoinStyle = 'miter'): MultiPolygon {
  if (distance < 0) throw new RangeError('inset distance must be >= 0');
  if (distance < EPS) return mp;
  return offsetMultiPolygon(mp, -distance, join);
}

/** True when insetting by `distance` would leave nothing - i.e. the zone is narrower than 2x the setback. */
export function insetVanishes(mp: MultiPolygon, distance: number): boolean {
  return multiPolygonArea(inset(mp, distance)) <= EPS;
}
