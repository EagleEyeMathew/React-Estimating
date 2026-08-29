import { describe, expect, it } from 'vitest';
import { boundingSection, sectionOutline, type SectionProfile } from '../src/section.js';
import { area } from '../src/ring.js';

/** A 16mm deep top hat with 35mm crown and 10mm flanges, 1mm gauge. */
const TOP_HAT: SectionProfile = {
  kind: 'sheet',
  thickness: 1,
  spine: [
    [-27.5, 16],
    [-17.5, 16],
    [-17.5, 0],
    [17.5, 0],
    [17.5, 16],
    [27.5, 16],
  ],
};

describe('section profiles', () => {
  it('thickens a folded sheet into a closed outline of the right size', () => {
    const s = sectionOutline(TOP_HAT)!;
    expect(s).not.toBeNull();
    // The ends are butted, so the sheet stops at the flange tips: 55mm across.
    // Across the fold it is thickened both sides, so 16mm deep becomes 17.
    expect(s.width).toBeCloseTo(55, 1);
    expect(s.depth).toBeCloseTo(17, 1);
    // Roughly the developed length times the gauge.
    const developed = 10 + 16 + 35 + 16 + 10;
    expect(s.area).toBeGreaterThan(developed * 0.9);
    expect(s.area).toBeLessThan(developed * 1.3);
  });

  it('keeps the setout line at the section origin', () => {
    const s = sectionOutline(TOP_HAT)!;
    const ys = s.rings.flat().map((p) => p.y);
    // The crown runs along y=0, so the section straddles it by half the gauge.
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 3);
  });

  it('draws a round bar', () => {
    const s = sectionOutline({ kind: 'round', diameter: 6 })!;
    expect(s.width).toBeCloseTo(6, 0);
    expect(s.depth).toBeCloseTo(6, 0);
    expect(s.area).toBeGreaterThan(Math.PI * 9 * 0.95);
    expect(s.area).toBeLessThanOrEqual(Math.PI * 9);
  });

  it('draws a solid outline as given', () => {
    const s = sectionOutline({ kind: 'solid', outline: [[-10, 0], [10, 0], [10, 5], [-10, 5]] })!;
    expect(s.width).toBe(20);
    expect(s.depth).toBe(5);
    expect(s.area).toBeCloseTo(100, 6);
  });

  it('handles an angle section', () => {
    const s = sectionOutline({ kind: 'sheet', thickness: 1, spine: [[0, 25], [0, 0], [25, 0]] })!;
    expect(s.width).toBeCloseTo(25.5, 1);
    expect(s.depth).toBeCloseTo(25.5, 1);
  });

  it('refuses a profile that cannot be drawn rather than rendering garbage', () => {
    expect(sectionOutline({ kind: 'sheet', thickness: 0, spine: [[0, 0], [10, 0]] })).toBeNull();
    expect(sectionOutline({ kind: 'sheet', thickness: 1, spine: [[0, 0]] })).toBeNull();
    expect(sectionOutline({ kind: 'round', diameter: 0 })).toBeNull();
    expect(sectionOutline({ kind: 'solid', outline: [[0, 0], [10, 0]] })).toBeNull();
    // A self-intersecting outline is a drawing error, not a shape.
    expect(
      sectionOutline({ kind: 'solid', outline: [[0, 0], [10, 10], [10, 0], [0, 10]] }),
    ).toBeNull();
  });

  it('falls back to the bounding rectangle when only the size is known', () => {
    const s = sectionOutline(boundingSection(35, 16))!;
    expect(s.width).toBe(35);
    expect(s.depth).toBe(16);
    expect(area(s.rings[0]!)).toBeCloseTo(35 * 16, 6);
  });

  it('is deterministic', () => {
    const run = () => JSON.stringify(sectionOutline(TOP_HAT));
    expect(run()).toBe(run());
  });
});
