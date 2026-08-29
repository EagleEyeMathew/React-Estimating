import { describe, expect, it } from 'vitest';
import { RulePackRegistry, builtinRegistry, setValueAt, type RulePack } from '@ceiling/rules';
import { generate } from '../src/generate.js';
import { SQUARE, project, zone } from './fixtures.js';

/**
 * A four-tier suspension: slotted angle across the joists, an M10 rod down to a strut,
 * an M6 rod down to the top cross rails, furring clipped up under them.
 *
 * Taken from a real detail. The pack ships with the figures the detail carries and no
 * more, so the ones it does not carry are filled in here - invented, and never leaving
 * this file - to prove the chain generates and that each rod spans between the two
 * layers it actually joins.
 */

// Levels above the finished ceiling, mirroring the detail's build-up.
const LEVELS = {
  furring: 13, // on top of 13mm lining
  topCrossRail: 51, // 13 + the 38 deep furring channel
  strut: 472, // 400mm of M6 rod above the rails
  slottedAngle: 772, // 300mm of M10 rod above the strut
};
const JOIST_SOFFIT_ABOVE_FCL = 813;

function filled(): RulePack {
  let pack = builtinRegistry().get('rondo_flexistrut', '2026.1')!;
  const set = (path: string, value: number): void => {
    pack = setValueAt(pack, path, value);
  };
  set('layers.furring.heightAboveFcl', LEVELS.furring);
  set('layers.top_cross_rail.heightAboveFcl', LEVELS.topCrossRail);
  set('layers.strut.heightAboveFcl', LEVELS.strut);
  set('layers.slotted_angle.heightAboveFcl', LEVELS.slottedAngle);
  set('layers.furring.maxSpacing', 450);
  set('layers.furring.maxFromWall', 150);
  set('layers.top_cross_rail.maxSpacing', 1200);
  set('layers.top_cross_rail.maxFromWall', 150);
  set('layers.strut.maxSpacing', 1200);
  set('layers.strut.maxFromWall', 300);
  set('layers.slotted_angle.maxFromWall', 300);
  set('layers.joist_fixing.maxSpacing', 500);
  set('layers.joist_fixing.firstFromEnd', 100);
  set('layers.upper_rod.firstFromEnd', 150);
  set('layers.lower_rod.firstFromEnd', 150);
  set('layers.rail_clip.maxSpacing', 1200);
  set('layers.rail_clip.firstFromEnd', 150);
  set('layers.wall_angle.fixingCentres', 450);
  set('layers.wall_angle.firstFixingFromCorner', 100);
  set('penetration.clearance', 25);
  return { ...pack, version: '2026.1-test', status: 'example' };
}

function run() {
  const pack = filled();
  const registry = new RulePackRegistry();
  for (const p of builtinRegistry().list()) registry.register(p);
  registry.register(pack);
  return generate({
    project: project(
      [
        zone({
          id: 'z1',
          boundary: SQUARE,
          plane: { kind: 'horizontal', level: 3110 },
          system: { pack: 'rondo_flexistrut', version: '2026.1-test', loadCase: '13mm_plasterboard' },
          disabledLayers: [],
        }),
      ],
      [
        {
          id: 'slab',
          name: 'Existing joists',
          kind: 'joists',
          plane: { kind: 'horizontal', level: 3110 + JOIST_SOFFIT_ABOVE_FCL },
          direction: { x: 1, y: 0 },
          spacing: 450,
          offset: 0,
          width: 45,
        },
      ],
    ),
    registry,
  });
}

describe('four-tier suspension', () => {
  const result = run();
  const of = (layer: string) => result.members.filter((m) => m.layerId === layer);

  it('generates every tier', () => {
    for (const layer of ['furring', 'top_cross_rail', 'strut', 'slotted_angle', 'upper_rod', 'lower_rod', 'rail_clip']) {
      expect(of(layer).length, layer).toBeGreaterThan(0);
    }
  });

  it('stacks the tiers in the right order above the ceiling', () => {
    const level = (layer: string) => of(layer)[0]!.start.z - 3110;
    expect(level('furring')).toBe(LEVELS.furring);
    expect(level('top_cross_rail')).toBe(LEVELS.topCrossRail);
    expect(level('strut')).toBe(LEVELS.strut);
    expect(level('slotted_angle')).toBe(LEVELS.slottedAngle);
  });

  it('runs the lower rod from the strut down to the top of the rail, not to the slab', () => {
    for (const rod of of('lower_rod')) {
      expect(rod.end.z - 3110).toBe(LEVELS.strut);
      // 51 for the rail plus its 21mm depth.
      expect(rod.start.z - 3110).toBe(LEVELS.topCrossRail + 21);
      expect(rod.length).toBe(LEVELS.strut - LEVELS.topCrossRail - 21);
      expect(rod.productCode).toBe('M6-ROD');
      expect(rod.fixings[0]!.substrate).toBe('Flexistrut FM1000T');
    }
  });

  it('runs the upper rod from the slotted angle down to the strut', () => {
    for (const rod of of('upper_rod')) {
      expect(rod.end.z - 3110).toBe(LEVELS.slottedAngle);
      expect(rod.start.z - 3110).toBe(LEVELS.strut);
      expect(rod.length).toBe(LEVELS.slottedAngle - LEVELS.strut);
      expect(rod.productCode).toBe('M10-ROD');
      expect(rod.fixings[0]!.substrate).toBe('slotted angle');
    }
  });

  it('only the joist fixing reaches the structure, and it lands on a joist', () => {
    for (const fixing of of('joist_fixing')) {
      expect(fixing.end.z - 3110).toBe(JOIST_SOFFIT_ABOVE_FCL);
      expect(fixing.fixings[0]!.substrate).toBe('existing joist');
      // Joists at 450 centres from the origin: a fixing has to land on one.
      const onJoist = Math.abs(fixing.start.y - Math.round(fixing.start.y / 450) * 450) <= 45 / 2 + 1;
      const bridged = result.members.some((m) => m.type === 'bridging');
      expect(onJoist || bridged, `fixing at ${fixing.start.x},${fixing.start.y}`).toBe(true);
    }
    // No other tier tries to reach the joists.
    for (const rod of [...of('upper_rod'), ...of('lower_rod')]) {
      expect(rod.end.z - 3110).toBeLessThan(JOIST_SOFFIT_ABOVE_FCL);
    }
  });

  it('never leaves a rod hanging above what it is meant to hold', () => {
    for (const rod of result.members.filter((m) => m.type === 'hanger')) {
      expect(rod.length).toBeGreaterThanOrEqual(0);
      expect(rod.end.z).toBeGreaterThanOrEqual(rod.start.z);
    }
  });

  it('the shipped pack itself will not generate, because the detail does not carry the spans', () => {
    const asShipped = generate({
      project: project([
        zone({
          id: 'z1',
          boundary: SQUARE,
          system: { pack: 'rondo_flexistrut', version: '2026.1', loadCase: '13mm_plasterboard' },
        }),
      ]),
      registry: builtinRegistry(),
    });
    expect(asShipped.members).toEqual([]);
    expect(asShipped.issues.some((i) => i.code === 'RULE_VALUE_MISSING' || i.code === 'SPACING_UNRESOLVED')).toBe(true);
  });
});
