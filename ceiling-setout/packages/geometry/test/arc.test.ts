import { describe, expect, it } from 'vitest';
import { arcLength, arcRadius, arcSegmentCount, arcSweep, boundaryToRing, edgeAt, tessellateArc } from '../src/arc.js';
import type { Arc, BoundaryPath } from '../src/types.js';
import { area } from '../src/ring.js';

const quarter: Arc = {
  kind: 'arc',
  start: { x: 1000, y: 0 },
  end: { x: 0, y: 1000 },
  centre: { x: 0, y: 0 },
  ccw: true,
};

describe('arc', () => {
  it('measures radius, sweep and length', () => {
    expect(arcRadius(quarter)).toBeCloseTo(1000, 6);
    expect(arcSweep(quarter)).toBeCloseTo(Math.PI / 2, 9);
    expect(arcLength(quarter)).toBeCloseTo((Math.PI / 2) * 1000, 6);
  });

  it('handles a clockwise arc between the same points', () => {
    const cw: Arc = { ...quarter, ccw: false };
    expect(arcSweep(cw)).toBeCloseTo((3 * Math.PI) / 2, 9);
  });

  it('chooses a segment count that honours the chord tolerance', () => {
    const n = arcSegmentCount(quarter, 1);
    const pts = tessellateArc(quarter, 1);
    expect(pts).toHaveLength(n);
    // Mid-chord deviation must be within tolerance.
    const step = arcSweep(quarter) / n;
    const sagitta = arcRadius(quarter) * (1 - Math.cos(step / 2));
    expect(sagitta).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('tightening the tolerance adds segments', () => {
    expect(arcSegmentCount(quarter, 0.1)).toBeGreaterThan(arcSegmentCount(quarter, 5));
  });

  it('tessellates a boundary of mixed lines and arcs into a ring', () => {
    const path: BoundaryPath = {
      chordTolerance: 0.5,
      edges: [
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
        quarter,
        { kind: 'line', start: { x: 0, y: 1000 }, end: { x: 0, y: 0 } },
      ],
    };
    const ring = boundaryToRing(path);
    // Quarter disc plus nothing else: area approaches pi r^2 / 4.
    expect(area(ring)).toBeGreaterThan(0.999 * (Math.PI * 1000 * 1000) / 4);
    expect(area(ring)).toBeLessThanOrEqual((Math.PI * 1000 * 1000) / 4);
  });

  it('maps a tessellated point back to the true edge it came from', () => {
    const path: BoundaryPath = {
      chordTolerance: 0.5,
      edges: [
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
        quarter,
        { kind: 'line', start: { x: 0, y: 1000 }, end: { x: 0, y: 0 } },
      ],
    };
    const mid = tessellateArc(quarter, 0.5)[3]!;
    expect(edgeAt(path, mid)).toBe(1);
    expect(edgeAt(path, { x: 500, y: 0 })).toBe(0);
  });
});
