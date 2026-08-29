import { describe, expect, it } from 'vitest';
import { difference, intersection, union, workableRegion } from '../src/boolean.js';
import { circle, multiPolygonArea, normalisePolygon, rectangle } from '../src/polygon.js';
import { L_ROOM } from './fixtures.js';

const poly = (r: Parameters<typeof normalisePolygon>[0]['outer']) => normalisePolygon({ outer: r, holes: [] });

describe('boolean operations', () => {
  it('subtracts a hole from a boundary', () => {
    const region = workableRegion(rectangle(0, 0, 1000, 1000), [rectangle(200, 200, 400, 400)]);
    expect(multiPolygonArea(region)).toBeCloseTo(1000 * 1000 - 200 * 200, 3);
    expect(region).toHaveLength(1);
    expect(region[0]!.holes).toHaveLength(1);
  });

  it('subtracts obstructions that overlap the boundary edge', () => {
    const region = workableRegion(rectangle(0, 0, 1000, 1000), [], [rectangle(-100, -100, 200, 200)]);
    expect(multiPolygonArea(region)).toBeCloseTo(1000 * 1000 - 200 * 200, 3);
    // Cutting a corner leaves a single simple polygon, not a hole.
    expect(region[0]!.holes).toHaveLength(0);
  });

  it('splits a region into two when an obstruction cuts right across it', () => {
    const region = workableRegion(rectangle(0, 0, 1000, 1000), [], [rectangle(-50, 400, 1050, 600)]);
    expect(region).toHaveLength(2);
    expect(multiPolygonArea(region)).toBeCloseTo(1000 * 400 + 1000 * 400, 3);
  });

  it('keeps an island inside a hole as its own polygon', () => {
    const outer = poly(rectangle(0, 0, 1000, 1000));
    const bigHole = poly(rectangle(200, 200, 800, 800));
    const island = poly(rectangle(400, 400, 600, 600));
    const region = union(difference([outer], [bigHole]), [island]);
    expect(region).toHaveLength(2);
    expect(multiPolygonArea(region)).toBeCloseTo(1000 * 1000 - 600 * 600 + 200 * 200, 3);
  });

  it('intersects an L-room with a circle', () => {
    const r = intersection([poly(L_ROOM)], [poly(circle({ x: 2000, y: 2000 }, 1000, 64))]);
    expect(multiPolygonArea(r)).toBeGreaterThan(Math.PI * 1000 * 1000 * 0.99);
    expect(multiPolygonArea(r)).toBeLessThanOrEqual(Math.PI * 1000 * 1000 * 1.001);
  });

  it('is deterministic - repeated runs are byte-identical', () => {
    const run = () => JSON.stringify(workableRegion(L_ROOM, [circle({ x: 2000, y: 2000 }, 500, 24)]));
    expect(run()).toBe(run());
  });
});
