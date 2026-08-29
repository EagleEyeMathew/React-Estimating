import { describe, expect, it } from 'vitest';
import { inset, insetVanishes, outset } from '../src/offset.js';
import { multiPolygonArea, multiPolygonBBox, normalisePolygon, rectangle } from '../src/polygon.js';
import { pointInMultiPolygon } from '../src/predicates.js';
import { L_ROOM } from './fixtures.js';

const region = [normalisePolygon({ outer: L_ROOM, holes: [] })];

describe('offset', () => {
  it('insets a rectangle by the exact distance on every side', () => {
    const r = inset([normalisePolygon({ outer: rectangle(0, 0, 1000, 800), holes: [] })], 100);
    const b = multiPolygonBBox(r);
    expect(b.minX).toBeCloseTo(100, 6);
    expect(b.minY).toBeCloseTo(100, 6);
    expect(b.maxX).toBeCloseTo(900, 6);
    expect(b.maxY).toBeCloseTo(700, 6);
  });

  it('handles the reflex corner of an L-room correctly', () => {
    const r = inset(region, 200);
    // The reflex vertex at (4000,4000) moves diagonally in to (3800,3800): the inset
    // region is the union of the two inset arms, so the notch corner is cut back on
    // both faces rather than being nudged along one of them.
    expect(pointInMultiPolygon({ x: 3700, y: 3700 }, r)).toBe('inside');
    expect(pointInMultiPolygon({ x: 3900, y: 3900 }, r)).toBe('outside');
    expect(pointInMultiPolygon({ x: 3900, y: 3000 }, r)).toBe('inside');
    expect(pointInMultiPolygon({ x: 3000, y: 3900 }, r)).toBe('inside');
    expect(multiPolygonArea(r)).toBeLessThan(multiPolygonArea(region));
  });

  it('grows a hole when the polygon shrinks', () => {
    const withHole = [normalisePolygon({ outer: rectangle(0, 0, 2000, 2000), holes: [rectangle(800, 800, 1200, 1200)] })];
    const r = inset(withHole, 100);
    expect(r[0]!.holes).toHaveLength(1);
    const holeArea = multiPolygonArea([{ outer: r[0]!.holes[0]!, holes: [] }]);
    expect(holeArea).toBeCloseTo(600 * 600, 1);
  });

  it('drops regions narrower than twice the inset', () => {
    const thin = [normalisePolygon({ outer: rectangle(0, 0, 5000, 150), holes: [] })];
    expect(inset(thin, 100)).toHaveLength(0);
    expect(insetVanishes(thin, 100)).toBe(true);
    expect(insetVanishes(region, 100)).toBe(false);
  });

  it('outset is the inverse of inset for a convex shape', () => {
    const sq = [normalisePolygon({ outer: rectangle(0, 0, 1000, 1000), holes: [] })];
    const back = outset(inset(sq, 100), 100);
    expect(multiPolygonArea(back)).toBeCloseTo(1000 * 1000, 1);
  });
});
