import { describe, expect, it } from 'vitest';
import { distanceToBoundary, excursionDepth, holePenetrationDepth, isSegmentInside, pointInMultiPolygon, pointInRing, segmentCrossesHole } from '../src/predicates.js';
import { workableRegion } from '../src/boolean.js';
import { circle, rectangle } from '../src/polygon.js';
import { L_ROOM } from './fixtures.js';

describe('predicates', () => {
  const region = workableRegion(rectangle(0, 0, 1000, 1000), [rectangle(400, 400, 600, 600)]);

  it('reports points exactly on a boundary as boundary, not arbitrarily in or out', () => {
    expect(pointInRing({ x: 0, y: 500 }, rectangle(0, 0, 1000, 1000))).toBe('boundary');
    expect(pointInRing({ x: 0, y: 0 }, rectangle(0, 0, 1000, 1000))).toBe('boundary');
    expect(pointInMultiPolygon({ x: 400, y: 500 }, region)).toBe('boundary');
  });

  it('reports points in a hole as outside', () => {
    expect(pointInMultiPolygon({ x: 500, y: 500 }, region)).toBe('outside');
    expect(pointInMultiPolygon({ x: 100, y: 100 }, region)).toBe('inside');
    expect(pointInMultiPolygon({ x: -1, y: 100 }, region)).toBe('outside');
  });

  it('detects a segment that leaves and re-enters a concave region', () => {
    const l = workableRegion(L_ROOM, []);
    // From the lower-right arm to the upper arm - passes outside the notch.
    expect(isSegmentInside({ a: { x: 7000, y: 1000 }, b: { x: 1000, y: 8000 } }, l)).toBe(false);
    expect(isSegmentInside({ a: { x: 1000, y: 1000 }, b: { x: 3000, y: 8000 } }, l)).toBe(true);
  });

  it('detects a segment crossing a hole', () => {
    expect(segmentCrossesHole({ a: { x: 0, y: 500 }, b: { x: 1000, y: 500 } }, region)).toBe(true);
    expect(segmentCrossesHole({ a: { x: 0, y: 100 }, b: { x: 1000, y: 100 } }, region)).toBe(false);
  });

  it('measures distance to the nearest boundary including holes', () => {
    expect(distanceToBoundary({ x: 200, y: 500 }, region)).toBeCloseTo(200, 6);
    expect(distanceToBoundary({ x: 300, y: 500 }, region)).toBeCloseTo(100, 6);
  });

  it('measures excursion by depth, not by overlap length', () => {
    const l = workableRegion(L_ROOM, []);
    // Runs 6m along just 1mm outside the wall: long overlap, 1mm deep.
    expect(excursionDepth({ a: { x: -1, y: 1000 }, b: { x: -1, y: 7000 } }, l)).toBeCloseTo(1, 1);
    // Cuts 2m into the notch: short overlap, deep.
    expect(excursionDepth({ a: { x: 4000, y: 6000 }, b: { x: 6000, y: 6000 } }, l)).toBeGreaterThan(900);
    expect(excursionDepth({ a: { x: 1000, y: 1000 }, b: { x: 3000, y: 3000 } }, l)).toBe(0);
  });

  it('treats a member tangent to a column as clear of it', () => {
    const col = workableRegion(rectangle(0, 0, 4000, 4000), [circle({ x: 2000, y: 2000 }, 500, 64)]);
    // Tangent to the column: touches, does not pass through.
    const tangent = { a: { x: 0, y: 1500 }, b: { x: 4000, y: 1500 } };
    expect(holePenetrationDepth(tangent, col)).toBeLessThan(0.01);
    expect(segmentCrossesHole(tangent, col)).toBe(false);
    // Straight through the middle.
    const through = { a: { x: 0, y: 2000 }, b: { x: 4000, y: 2000 } };
    expect(holePenetrationDepth(through, col)).toBeGreaterThan(490);
    expect(segmentCrossesHole(through, col)).toBe(true);
  });

  it('rejects a member that clips the corner of a column', () => {
    const col = workableRegion(rectangle(0, 0, 4000, 4000), [rectangle(1000, 1000, 3000, 3000)]);
    expect(isSegmentInside({ a: { x: 0, y: 900 }, b: { x: 4000, y: 1100 } }, col)).toBe(false);
  });
});
