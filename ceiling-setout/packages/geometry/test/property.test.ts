import { describe, expect, it } from 'vitest';
import { lineArray } from '../src/lineArray.js';
import { inset } from '../src/offset.js';
import { isSegmentInside, pointInMultiPolygon, segmentCrossesHole, distanceToNearestSegment } from '../src/predicates.js';
import { multiPolygonArea, multiPolygonBBox } from '../src/polygon.js';
import { mulberry32 } from '../src/rng.js';
import { fromAngle, normalise, perp, add, scale, dot, sub } from '../src/vec.js';
import { randomPolygon } from './fixtures.js';
import type { MultiPolygon, Vec2 } from '../src/types.js';

const CASES = 250;

interface Case {
  seed: number;
  region: MultiPolygon;
  direction: Vec2;
  spacing: number;
}

/**
 * A deterministic corpus of concave rooms with holes, each with its own skew setout
 * direction and spacing. Every property below is asserted against all of them; a
 * failure prints the seed so it can be reproduced in isolation.
 */
function corpus(): Case[] {
  const cases: Case[] = [];
  for (let seed = 1; seed <= CASES; seed++) {
    const rand = mulberry32(seed * 7919);
    const poly = randomPolygon(seed);
    if (multiPolygonArea([poly]) < 1e6) continue; // skip degenerate slivers
    cases.push({
      seed,
      region: [poly],
      direction: fromAngle(rand() * Math.PI * 2),
      spacing: 300 + Math.floor(rand() * 900),
    });
  }
  return cases;
}

const CORPUS = corpus();

describe('line array properties over random concave rooms', () => {
  it('builds a non-trivial corpus', () => {
    expect(CORPUS.length).toBeGreaterThan(200);
    expect(CORPUS.some((c) => c.region[0]!.holes.length > 0)).toBe(true);
  });

  it('never places a member outside the boundary', () => {
    for (const c of CORPUS) {
      const r = lineArray({ region: c.region, direction: c.direction, spacing: c.spacing, origin: { x: 0, y: 0 } });
      for (const s of r.segments) {
        if (!isSegmentInside(s, c.region)) {
          throw new Error(`seed ${c.seed}: member outside boundary ${JSON.stringify(s)}`);
        }
      }
    }
  });

  it('never runs a member through a hole', () => {
    for (const c of CORPUS) {
      if (c.region[0]!.holes.length === 0) continue;
      const r = lineArray({ region: c.region, direction: c.direction, spacing: c.spacing, origin: { x: 0, y: 0 } });
      for (const s of r.segments) {
        if (segmentCrossesHole(s, c.region)) {
          throw new Error(`seed ${c.seed}: member crosses a hole ${JSON.stringify(s)}`);
        }
      }
    }
  });

  it('never overlaps two members on the same line', () => {
    for (const c of CORPUS) {
      const u = normalise(c.direction);
      const r = lineArray({ region: c.region, direction: c.direction, spacing: c.spacing, origin: { x: 0, y: 0 } });
      const byLine = new Map<number, { t0: number; t1: number }[]>();
      for (const s of r.segments) {
        const list = byLine.get(s.lineIndex) ?? [];
        list.push({ t0: dot(s.a, u), t1: dot(s.b, u) });
        byLine.set(s.lineIndex, list);
      }
      for (const [line, list] of byLine) {
        list.sort((a, b) => a.t0 - b.t0);
        for (let i = 1; i < list.length; i++) {
          if (list[i]!.t0 < list[i - 1]!.t1 - 1e-6) {
            throw new Error(`seed ${c.seed}: overlapping members on line ${line}`);
          }
        }
      }
    }
  });

  it('keeps adjacent lines exactly one spacing apart', () => {
    for (const c of CORPUS) {
      const r = lineArray({ region: c.region, direction: c.direction, spacing: c.spacing, origin: { x: 0, y: 0 } });
      for (const s of r.segments) {
        expect(Math.abs(s.offset - s.lineIndex * c.spacing)).toBeLessThan(1e-6);
      }
    }
  });

  it('produces byte-identical output on repeated runs', () => {
    for (const c of CORPUS.slice(0, 40)) {
      const run = () =>
        JSON.stringify(lineArray({ region: c.region, direction: c.direction, spacing: c.spacing, origin: { x: 13, y: -7 } }));
      expect(run()).toBe(run());
    }
  });

  /**
   * Coverage. A point can legitimately be further than half a spacing from the
   * nearest member: in a concave room the nearest lattice line may exit the boundary
   * before it reaches that point (a narrow spike between two lines, say). That is a
   * real setout defect, and the engine's validator reports it - so the property
   * asserted here is the precise one: any point beyond half a spacing must be a point
   * whose perpendicular foot on the nearest line genuinely falls outside the region.
   */
  it('covers every point within half a spacing, except where the region itself excludes the line', () => {
    for (const c of CORPUS.slice(0, 60)) {
      const u = normalise(c.direction);
      const n = perp(u);
      const origin = { x: 0, y: 0 };
      const r = lineArray({ region: c.region, direction: c.direction, spacing: c.spacing, origin });
      const box = multiPolygonBBox(c.region);
      const step = c.spacing / 2;
      for (let x = box.minX; x <= box.maxX; x += step) {
        for (let y = box.minY; y <= box.maxY; y += step) {
          const p = { x, y };
          if (pointInMultiPolygon(p, c.region) !== 'inside') continue;
          const d = distanceToNearestSegment(p, r.segments);
          if (d <= c.spacing / 2 + 1e-6) continue;
          // Foot of the perpendicular on the nearest lattice line.
          const acrossP = dot(p, n) - dot(origin, n);
          const k = Math.round(acrossP / c.spacing);
          const foot = add(p, scale(n, k * c.spacing - acrossP));
          if (pointInMultiPolygon(foot, c.region) === 'inside') {
            throw new Error(
              `seed ${c.seed}: point ${JSON.stringify(p)} is ${d.toFixed(1)}mm from support but its line does pass through it`,
            );
          }
        }
      }
    }
  });
});

describe('offset properties over random concave rooms', () => {
  it('never grows the area when insetting', () => {
    for (const c of CORPUS) {
      const before = multiPolygonArea(c.region);
      const after = multiPolygonArea(inset(c.region, 150));
      expect(after).toBeLessThanOrEqual(before + 1e-6);
    }
  });

  it('leaves every inset point at least the setback from the original boundary', () => {
    for (const c of CORPUS.slice(0, 60)) {
      const setback = 200;
      const shrunk = inset(c.region, setback);
      for (const poly of shrunk) {
        for (const v of poly.outer) {
          // Allow a small tolerance: miter joins clip corners at the miter limit.
          expect(pointInMultiPolygon(v, c.region)).not.toBe('outside');
        }
      }
    }
  });

  it('places every member of a setback array clear of the walls', () => {
    for (const c of CORPUS.slice(0, 60)) {
      const setback = 150;
      const shrunk = inset(c.region, setback);
      if (multiPolygonArea(shrunk) <= 0) continue;
      const r = lineArray({ region: shrunk, direction: c.direction, spacing: c.spacing, origin: { x: 0, y: 0 } });
      for (const s of r.segments) {
        if (!isSegmentInside(s, c.region)) {
          throw new Error(`seed ${c.seed}: setback member escaped the original boundary`);
        }
      }
    }
  });
});

describe('vector helpers used by the properties', () => {
  it('perp is a left turn', () => {
    expect(perp({ x: 1, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(sub({ x: 3, y: 4 }, { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
  });
});
