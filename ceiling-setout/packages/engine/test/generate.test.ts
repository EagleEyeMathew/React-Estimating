import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import { L_ROOM, SQUARE, KEYLOCK, project, registry, slab, zone } from './fixtures.js';

const run = (z: Parameters<typeof project>[0], s?: Parameters<typeof project>[1]) =>
  generate({ project: project(z, s), registry: registry() });

describe('generation on a plain room', () => {
  const result = run([zone({ id: 'z1', boundary: SQUARE })]);
  const members = result.members;
  const of = (layer: string) => members.filter((m) => m.layerId === layer);

  it('generates every layer the pack declares', () => {
    expect(of('furring').length).toBeGreaterThan(0);
    expect(of('tsr').length).toBeGreaterThan(0);
    expect(of('hanger').length).toBeGreaterThan(0);
    expect(of('clip').length).toBeGreaterThan(0);
    expect(of('wall_angle').length).toBeGreaterThan(0);
  });

  it('runs the furring parallel to the longest wall', () => {
    const zoneResult = result.zones[0]!;
    expect(zoneResult.setout.directionDegrees).toBe(0);
    expect(zoneResult.setout.directionReason).toMatch(/longest wall/);
    for (const m of of('furring')) expect(Math.abs(m.rotation)).toBeLessThan(1e-6);
  });

  it('runs the TSRs across the furring', () => {
    for (const m of of('tsr')) expect(Math.abs(Math.abs(m.rotation) - Math.PI / 2)).toBeLessThan(1e-6);
  });

  it('spaces the furring at the resolved spacing', () => {
    expect(result.zones[0]!.spacings.furring).toEqual({
      spacing: 450,
      governedBy: 'layers.furring.maxSpacing',
    });
    const ys = [...new Set(of('furring').map((m) => m.start.y))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeLessThanOrEqual(450 + 1e-6);
  });

  it('carries provenance on every member', () => {
    for (const m of members) {
      expect(m.provenance.rulePackVersion).toBe('rondo_keylock@2026.1-example');
      expect(m.provenance.ruleId).not.toBe('');
      expect(m.provenance.reason.length).toBeGreaterThan(5);
    }
  });

  it('states on the output that the pack values are invented', () => {
    expect(result.banners.join(' ')).toMatch(/INVENTED EXAMPLE DATA/);
    expect(result.banners.join(' ')).toMatch(/engineer/);
  });

  it('gives every hanger a drop from the soffit to the top of the system', () => {
    const hangers = of('hanger');
    expect(hangers.length).toBeGreaterThan(0);
    // Soffit at 3400, FCL 2700, system depth 120.
    for (const h of hangers) {
      expect(h.length).toBe(3400 - 2700 - 120);
      expect(h.fixings[0]!.substrate).toBe('concrete soffit');
    }
  });

  it('is deterministic', () => {
    const a = JSON.stringify(run([zone({ id: 'z1', boundary: SQUARE })]));
    const b = JSON.stringify(run([zone({ id: 'z1', boundary: SQUARE })]));
    expect(a).toBe(b);
  });
});

describe('generation on a concave room', () => {
  const result = run([zone({ id: 'z1', boundary: L_ROOM })]);

  it('splits members at the notch instead of bridging the void', () => {
    const furring = result.members.filter((m) => m.layerId === 'furring');
    expect(furring.length).toBeGreaterThan(10);
    // The longest wall is the 9m one, so the furring runs up the page. Members in the
    // tall arm run the full 9m; those in the short arm stop at the notch at y=4000
    // rather than carrying on across open air.
    const tall = furring.filter((m) => m.start.x < 4000);
    const short = furring.filter((m) => m.start.x > 4000);
    expect(tall.length).toBeGreaterThan(0);
    expect(short.length).toBeGreaterThan(0);
    for (const m of tall) expect(m.planLength).toBe(9000);
    for (const m of short) expect(m.planLength).toBe(4000);
  });

  it('reports nothing outside the boundary', () => {
    const bad = result.issues.filter((i) => i.code === 'MEMBER_OUTSIDE_ZONE');
    expect(bad).toEqual([]);
  });

  it('supports every part of the ceiling', () => {
    expect(result.issues.filter((i) => i.code === 'UNSUPPORTED_AREA')).toEqual([]);
  });
});

describe('a pack with nothing entered', () => {
  it('refuses to generate and says which figures are missing', () => {
    const result = run([
      zone({ id: 'z1', boundary: SQUARE, system: { ...KEYLOCK, version: '2026.1' } }),
    ]);
    expect(result.members).toEqual([]);
    const missing = result.issues.filter((i) => i.code === 'RULE_VALUE_MISSING' || i.code === 'SPACING_UNRESOLVED');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.map((i) => i.ruleId)).toContain('layers.furring.maxSpacing');
  });
});
