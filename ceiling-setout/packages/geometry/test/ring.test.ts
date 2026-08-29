import { describe, expect, it } from 'vitest';
import { area, cleanRing, centroid, isCCW, isSimple, longestEdge, principalAxis, signedArea, toCCW } from '../src/ring.js';
import { rectangle } from '../src/polygon.js';
import { L_ROOM } from './fixtures.js';

describe('ring', () => {
  it('computes signed area with orientation', () => {
    const r = rectangle(0, 0, 100, 50);
    expect(signedArea(r)).toBe(5000);
    expect(signedArea([...r].reverse())).toBe(-5000);
    expect(isCCW(r)).toBe(true);
  });

  it('computes L-room area as the sum of its two rectangles', () => {
    // 8000x4000 plus 4000x5000
    expect(area(L_ROOM)).toBe(8000 * 4000 + 4000 * 5000);
  });

  it('normalises orientation without changing area', () => {
    const cw = [...L_ROOM].reverse();
    expect(isCCW(toCCW(cw))).toBe(true);
    expect(area(toCCW(cw))).toBe(area(L_ROOM));
  });

  it('removes duplicate and collinear vertices', () => {
    const r = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(cleanRing(r)).toHaveLength(4);
  });

  it('detects self-intersection', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(isSimple(bowtie)).toBe(false);
    expect(isSimple(L_ROOM)).toBe(true);
  });

  it('finds the longest edge deterministically', () => {
    const e = longestEdge(L_ROOM);
    expect(e.length).toBe(9000);
    // Ties must resolve the same way every time.
    const sq = rectangle(0, 0, 100, 100);
    expect(longestEdge(sq).index).toBe(longestEdge(sq).index);
  });

  it('finds a principal axis that is not snapped to world axes', () => {
    const skew = [
      { x: 0, y: 0 },
      { x: 10000, y: 1228 }, // 7 degrees
      { x: 9000, y: 5000 },
      { x: -1000, y: 3772 },
    ];
    const axis = principalAxis(skew);
    expect(Math.abs(axis.y)).toBeGreaterThan(0.01);
  });

  it('computes an area-weighted centroid inside the shape', () => {
    const c = centroid(rectangle(0, 0, 100, 200));
    expect(c.x).toBeCloseTo(50, 6);
    expect(c.y).toBeCloseTo(100, 6);
  });
});
