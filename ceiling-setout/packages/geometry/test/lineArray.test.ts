import { describe, expect, it } from 'vitest';
import { balancedOffset, balancedOrigin, distributeAlong, lineArray, projectRange } from '../src/lineArray.js';
import { workableRegion } from '../src/boolean.js';
import { circle, normalisePolygon, rectangle } from '../src/polygon.js';
import { isSegmentInside, segmentCrossesHole } from '../src/predicates.js';
import { fromAngle } from '../src/vec.js';
import { L_ROOM } from './fixtures.js';

describe('line array', () => {
  it('clips a family of lines to a rectangle at exact spacing', () => {
    const region = workableRegion(rectangle(0, 0, 3000, 2000), []);
    const r = lineArray({ region, direction: { x: 1, y: 0 }, spacing: 450, origin: { x: 0, y: 0 } });
    expect(r.segments.every((s) => Math.abs(s.length - 3000) < 1e-6)).toBe(true);
    const offsets = r.segments.map((s) => s.offset);
    expect(offsets).toEqual([0, 450, 900, 1350, 1800]);
  });

  it('splits a line into separate members where it crosses a hole', () => {
    const region = workableRegion(rectangle(0, 0, 3000, 2000), [rectangle(1000, 800, 2000, 1200)]);
    const r = lineArray({ region, direction: { x: 1, y: 0 }, spacing: 200, origin: { x: 0, y: 1000 } });
    const throughHole = r.segments.filter((s) => s.offset === 0);
    expect(throughHole).toHaveLength(2);
    expect(throughHole[0]!.a.x).toBe(0);
    expect(throughHole[0]!.b.x).toBe(1000);
    expect(throughHole[1]!.a.x).toBe(2000);
    expect(throughHole[1]!.b.x).toBe(3000);
    // No member bridges the void.
    expect(r.segments.some((s) => segmentCrossesHole(s, region))).toBe(false);
  });

  it('splits a line into separate members across a concave notch', () => {
    const region = workableRegion(L_ROOM, []);
    const r = lineArray({ region, direction: { x: 1, y: 0 }, spacing: 500, origin: { x: 0, y: 0 } });
    // Above y=4000 the room is only 4000 wide; below it is 8000 wide.
    const upper = r.segments.filter((s) => s.a.y > 4000);
    expect(upper.every((s) => Math.abs(s.length - 4000) < 1e-6)).toBe(true);
    const lower = r.segments.filter((s) => s.a.y < 4000);
    expect(lower.every((s) => Math.abs(s.length - 8000) < 1e-6)).toBe(true);
  });

  it('keeps every member inside the region', () => {
    const region = workableRegion(L_ROOM, [circle({ x: 2000, y: 2000 }, 400, 24)]);
    const r = lineArray({ region, direction: fromAngle((7 * Math.PI) / 180), spacing: 300, origin: { x: 0, y: 0 } });
    expect(r.segments.length).toBeGreaterThan(10);
    for (const s of r.segments) expect(isSegmentInside(s, region)).toBe(true);
  });

  it('does not snap a skew direction to the world axes', () => {
    const region = workableRegion(rectangle(0, 0, 4000, 4000), []);
    const dir = fromAngle((7 * Math.PI) / 180);
    const r = lineArray({ region, direction: dir, spacing: 600, origin: { x: 0, y: 0 } });
    for (const s of r.segments) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      expect(Math.abs(Math.atan2(dy, dx) - Math.atan2(dir.y, dir.x))).toBeLessThan(1e-6);
    }
  });

  it('discards unusable offcuts instead of emitting them', () => {
    // A wedge produces very short pieces at the narrow end.
    const wedge = [normalisePolygon({ outer: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }], holes: [] })];
    const r = lineArray({ region: wedge, direction: { x: 1, y: 0 }, spacing: 200, origin: { x: 0, y: 0 }, minSegmentLength: 300 });
    expect(r.discarded.length).toBeGreaterThan(0);
    expect(r.segments.every((s) => s.length >= 300)).toBe(true);
    expect(r.discarded.every((s) => s.length < 300)).toBe(true);
  });

  it('uses a lattice index that is stable when the region grows on the far side', () => {
    const small = workableRegion(rectangle(0, 0, 3000, 2000), []);
    const big = workableRegion(rectangle(0, 0, 3000, 5000), []);
    const opts = { direction: { x: 1, y: 0 }, spacing: 400, origin: { x: 0, y: 0 } } as const;
    const a = lineArray({ ...opts, region: small });
    const b = lineArray({ ...opts, region: big });
    for (const s of a.segments) {
      const match = b.segments.find((t) => t.lineIndex === s.lineIndex && t.segmentIndex === s.segmentIndex);
      expect(match?.offset).toBe(s.offset);
    }
  });

  it('rejects a spacing that would explode the member count', () => {
    const region = workableRegion(rectangle(0, 0, 10000, 10000), []);
    expect(() => lineArray({ region, direction: { x: 1, y: 0 }, spacing: 0.5, origin: { x: 0, y: 0 } })).toThrow(/limit/);
  });

  it('is deterministic', () => {
    const region = workableRegion(L_ROOM, [circle({ x: 2000, y: 2000 }, 400, 24)]);
    const run = () => JSON.stringify(lineArray({ region, direction: fromAngle(0.3), spacing: 333, origin: { x: 17, y: -42 } }));
    expect(run()).toBe(run());
  });
});

describe('balanced setout', () => {
  it('leaves equal margins at both edges', () => {
    const start = balancedOffset({ min: 0, max: 5000 }, 1200);
    // 4 bays of 1200 = 4800, leaving 100 each side.
    expect(start).toBe(100);
  });

  it('centres a tile grid across a room so edge tiles match', () => {
    const region = workableRegion(rectangle(0, 0, 5000, 3400), []);
    const origin = balancedOrigin(region, { x: 1, y: 0 }, 1200);
    const r = lineArray({ region, direction: { x: 1, y: 0 }, spacing: 1200, origin });
    const ys = r.segments.map((s) => s.a.y).sort((a, b) => a - b);
    expect(ys[0]! - 0).toBeCloseTo(3400 - ys[ys.length - 1]!, 3);
  });
});

describe('distributeAlong', () => {
  it('places a fixing at each end within the first-from-end rule', () => {
    const p = distributeAlong(3000, 1200, 150);
    expect(p[0]).toBe(150);
    expect(p[p.length - 1]).toBe(2850);
  });

  it('never exceeds the maximum spacing', () => {
    for (const len of [500, 1000, 2400, 3600, 7250]) {
      const p = distributeAlong(len, 1200, 150);
      for (let i = 1; i < p.length; i++) expect(p[i]! - p[i - 1]!).toBeLessThanOrEqual(1200 + 1e-6);
    }
  });

  it('distributes evenly rather than leaving a short last bay', () => {
    const p = distributeAlong(3150, 1200, 150);
    const gaps = p.slice(1).map((v, i) => v - p[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
  });

  it('places a single fixing on a very short member', () => {
    expect(distributeAlong(200, 1200, 150)).toEqual([100]);
  });
});

describe('projectRange', () => {
  it('measures extent along an arbitrary direction', () => {
    const region = workableRegion(rectangle(0, 0, 1000, 0.0001), []);
    const r = projectRange(region, { x: 1, y: 0 });
    expect(r.min).toBe(0);
    expect(r.max).toBe(1000);
  });
});
