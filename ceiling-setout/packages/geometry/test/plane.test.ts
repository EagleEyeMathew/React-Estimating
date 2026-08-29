import { describe, expect, it } from 'vitest';
import { fallAcross, horizontalPlane, isHorizontal, planeZ, projectToPlane, rakedPlane, trueLength, trueLengthFactor } from '../src/plane.js';

describe('plane', () => {
  it('is flat for a horizontal plane', () => {
    const p = horizontalPlane(2700);
    expect(isHorizontal(p)).toBe(true);
    expect(planeZ(p, { x: 9999, y: -9999 })).toBe(2700);
    expect(trueLengthFactor(p, { x: 1, y: 0 })).toBe(1);
  });

  it('interpolates a 1:20 rake continuously', () => {
    const p = rakedPlane(2700, { x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 20);
    expect(planeZ(p, { x: 0, y: 0 })).toBe(2700);
    expect(planeZ(p, { x: 2000, y: 0 })).toBe(2800);
    expect(planeZ(p, { x: 2000, y: 5000 })).toBe(2800); // no fall across the slope
  });

  it('makes members running up the slope longer than their plan length', () => {
    const p = rakedPlane(2700, { x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 20);
    const f = trueLengthFactor(p, { x: 1, y: 0 });
    expect(f).toBeCloseTo(Math.sqrt(1 + 0.05 ** 2), 9);
    expect(trueLength({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } }, p)).toBeCloseTo(4000 * f, 3);
    // Across the slope the true length equals the plan length.
    expect(trueLengthFactor(p, { x: 0, y: 1 })).toBeCloseTo(1, 12);
  });

  it('reports the fall across a member', () => {
    const p = rakedPlane(2700, { x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 20);
    expect(fallAcross({ a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } }, p)).toBe(150);
  });

  it('projects a plan point onto the plane', () => {
    const p = rakedPlane(2700, { x: 0, y: 0 }, { x: 0, y: 1 }, -1 / 20);
    expect(projectToPlane({ x: 100, y: 1000 }, p)).toEqual({ x: 100, y: 1000, z: 2650 });
  });
});
