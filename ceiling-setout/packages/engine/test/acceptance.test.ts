import { describe, expect, it } from 'vitest';
import {
  distanceToBoundary,
  excursionDepth,
  holePenetrationDepth,
  closestPointOnSegment,
  trueLengthFactor,
  rakedPlane,
} from '@ceiling/geometry';
import { setValueAt } from '@ceiling/rules';
import { generate } from '../src/generate.js';
import { planSegment } from '../src/member.js';
import { structureCrossings } from '../src/steps/hangers.js';
import { penetrationWidth } from '../src/steps/resolveZone.js';
import type { Member } from '../src/types.js';
import {
  KEYLOCK,
  L_ROOM,
  SQUARE,
  column,
  diffuser,
  downlight,
  project,
  purlins,
  registry,
  skewLRoom,
  slab,
  zone,
} from './fixtures.js';

const framed = (m: Member): boolean =>
  m.layerId === 'furring' || m.layerId === 'tsr';

/**
 * Acceptance test 1 from the brief. An L-shaped room raked over by 7 degrees with two
 * circular columns in it - the case that breaks anything written against an
 * axis-aligned bounding rectangle.
 */
describe('L-shaped room, 7 degree skew, two circular columns', () => {
  const boundary = skewLRoom(7);
  // Two columns placed inside the skewed outline.
  const columns = [column({ x: 1500, y: 1500 }, 300), column({ x: 2600, y: 5200 }, 250)];
  const result = generate({
    project: project([zone({ id: 'z1', boundary, holes: columns })]),
    registry: registry(),
  });
  const zoneResult = result.zones[0]!;
  const region = zoneResult.region;

  it('does not square the setout up to the world axes', () => {
    // The longest wall of the L is the 9m one, so the setout runs up it: 90 degrees,
    // plus the 7 degree skew. What matters is that the 7 is still there.
    expect(zoneResult.setout.directionDegrees).toBeCloseTo(97, 1);
    expect(zoneResult.setout.directionReason).toMatch(/longest wall/);
    // And that nothing has quietly snapped a member back to an axis.
    for (const m of result.members.filter(framed)) {
      const angle = ((m.rotation * 180) / Math.PI + 360) % 90;
      expect(Math.min(angle, 90 - angle)).toBeGreaterThan(1);
    }
  });

  it('generates a full setout', () => {
    expect(result.members.filter(framed).length).toBeGreaterThan(20);
    expect(result.members.filter((m) => m.layerId === 'hanger').length).toBeGreaterThan(10);
  });

  it('keeps every member inside the boundary', () => {
    for (const m of result.members.filter(framed)) {
      const depth = excursionDepth(planSegment(m), region);
      expect(depth, `${m.id} strays ${depth}mm outside`).toBeLessThanOrEqual(1);
    }
    expect(result.issues.filter((i) => i.code === 'MEMBER_OUTSIDE_ZONE')).toEqual([]);
  });

  it('runs no member through either column', () => {
    for (const m of result.members.filter(framed)) {
      const depth = holePenetrationDepth(planSegment(m), region);
      expect(depth, `${m.id} passes ${depth}mm through a column`).toBeLessThanOrEqual(1);
    }
    expect(result.issues.filter((i) => i.code === 'MEMBER_THROUGH_OPENING')).toEqual([]);
  });

  it('respects the perimeter setback on every wall, including the skew one', () => {
    const furring = result.members.filter((m) => m.layerId === 'furring').map(planSegment);
    const setback = 150;
    // Walk every wall of the zone; anywhere the lining has to be fixed near a wall
    // that runs alongside the members, a member must be within the setback.
    for (const poly of region) {
      const ring = poly.outer;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const wall = { x: b.x - a.x, y: b.y - a.y };
        const wallLength = Math.hypot(wall.x, wall.y);
        if (wallLength < 1) continue;
        const u = { x: wall.x / wallLength, y: wall.y / wallLength };
        const dir = zoneResult.setout.direction;
        // Only walls within 45 degrees of the member direction take a parallel member.
        if (Math.abs(u.x * dir.y - u.y * dir.x) > Math.SQRT1_2) continue;
        for (let t = 0.1; t <= 0.9; t += 0.2) {
          const p = { x: a.x + wall.x * t, y: a.y + wall.y * t };
          const inward = { x: p.x - u.y * 1, y: p.y + u.x * 1 };
          if (distanceToBoundary(inward, region) < 1) continue;
          const nearest = Math.min(
            ...furring.map((s) => closestPointOnSegment(p, s.a, s.b).distance),
          );
          expect(nearest, `wall ${i} at t=${t.toFixed(1)} has no member within ${setback}mm`).toBeLessThanOrEqual(
            setback + 1,
          );
        }
      }
    }
  });

  it('raises no errors, and reports the column edges that need a local trimmer', () => {
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.code}: ${e.message}`)).toEqual([]);
    // The setback rule stops at the walls: a column gets a trimmer, not a member run
    // across the whole zone. Where that leaves a lining edge unsupported, it is said.
    const edges = result.issues.filter((i) => i.code === 'OPENING_EDGE_UNSUPPORTED');
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.message).toMatch(/local trimmer/);
      expect(e.location).not.toBeNull();
    }
  });

  it('schedules trim around a round column as one curved run, not 32 offcuts', () => {
    const trim = result.members.filter((m) => m.layerId === 'wall_angle');
    // Six walls plus one run around each column.
    expect(trim).toHaveLength(8);
    const curved = trim.filter((m) => m.path !== undefined);
    expect(curved).toHaveLength(2);
    for (const c of curved) {
      expect(c.provenance.reason).toMatch(/curved run/);
      // Circumference of a 300 or 250 radius column, near enough for a 32-gon.
      expect(c.length).toBeGreaterThan(2 * Math.PI * 250 * 0.98);
    }
  });
});

/** Acceptance test 2. A 1:20 rake. */
describe('raked ceiling at 1:20', () => {
  const result = generate({
    project: project([
      zone({
        id: 'z1',
        boundary: SQUARE,
        plane: { kind: 'raked', level: 2700, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, fall: 1 / 20 },
      }),
    ]),
    registry: registry(),
  });
  const hangers = result.members.filter((m) => m.layerId === 'hanger');

  it('varies the hanger drops continuously across the rake', () => {
    expect(hangers.length).toBeGreaterThan(5);
    const sorted = [...hangers].sort((a, b) => a.start.x - b.start.x);
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    // The ceiling rises 1:20 to the east, so the drop shortens by the same amount.
    const expected = (last.start.x - first.start.x) / 20;
    expect(first.length - last.length).toBeCloseTo(expected, 1);
  });

  it('computes each drop from the soffit level less the ceiling and build-up', () => {
    for (const h of hangers) {
      const ceiling = 2700 + h.start.x / 20;
      expect(h.length).toBeCloseTo(3400 - ceiling - 120, 1);
    }
  });

  it('makes members running up the slope longer than their plan length', () => {
    const factor = trueLengthFactor(rakedPlane(2700, { x: 0, y: 0 }, { x: 1, y: 0 }, 1 / 20), { x: 1, y: 0 });
    expect(factor).toBeCloseTo(Math.sqrt(1 + 0.05 ** 2), 9);
    const upSlope = result.members.filter((m) => m.layerId === 'furring');
    expect(upSlope.length).toBeGreaterThan(0);
    for (const m of upSlope) {
      expect(m.length).toBeCloseTo(m.planLength * factor, 1);
      expect(m.length).toBeGreaterThan(m.planLength);
    }
  });

  it('leaves members running across the slope at their plan length', () => {
    for (const m of result.members.filter((x) => x.layerId === 'tsr')) {
      expect(m.length).toBeCloseTo(m.planLength, 3);
    }
  });
});

/** Acceptance test 3. Fourteen downlights and three diffusers. */
describe('room with 14 downlights and 3 diffusers', () => {
  const lights = Array.from({ length: 14 }, (_, i) =>
    downlight(`dl${i + 1}`, { x: 600 + (i % 7) * 800, y: 900 + Math.floor(i / 7) * 2200 }),
  );
  const diffusers = [
    diffuser('df1', { x: 1500, y: 2000 }),
    diffuser('df2', { x: 3000, y: 2000 }),
    diffuser('df3', { x: 4500, y: 2000 }),
  ];
  const result = generate({
    project: project([zone({ id: 'z1', boundary: SQUARE, penetrations: [...lights, ...diffusers] })]),
    registry: registry(),
  });

  it('trims every diffuser and leaves the downlights to pass through the lining', () => {
    const trimmers = result.members.filter((m) => m.provenance.reason.includes('trimmer to the'));
    // Two trimmers per diffuser: one each side.
    expect(trimmers.length).toBeGreaterThanOrEqual(6);
    for (const d of diffusers) {
      expect(trimmers.some((t) => t.provenance.reason.includes(d.reference!))).toBe(true);
    }
    for (const l of lights) {
      expect(trimmers.some((t) => t.provenance.reason.includes(l.reference!))).toBe(false);
    }
  });

  it('lands no downlight on a furring channel', () => {
    const furring = result.members.filter((m) => m.layerId === 'furring').map(planSegment);
    for (const l of lights) {
      const radius = penetrationWidth(l.shape) / 2;
      const nearest = Math.min(...furring.map((s) => closestPointOnSegment(l.shape.centre, s.a, s.b).distance));
      expect(nearest - radius, `${l.reference} clashes with a furring channel`).toBeGreaterThanOrEqual(60 - 1);
    }
    expect(result.issues.filter((i) => i.code === 'PENETRATION_ON_MEMBER')).toEqual([]);
  });

  it('says on the drawing what the setout gave up to achieve it', () => {
    // Clearing every light took a decision, and the decision has to be visible.
    const notes = result.issues.filter((i) => i.code === 'SETOUT_NUDGED' || i.code === 'EXTRA_BAYS_ADDED');
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n.severity).toBe('info');
    const extra = notes.find((i) => i.code === 'EXTRA_BAYS_ADDED');
    if (extra) expect(extra.message).toMatch(/extra material/);
  });

  it('runs no member through a trimmed opening', () => {
    const buildable = result.zones[0]!.buildableRegion;
    for (const m of result.members.filter(framed)) {
      expect(holePenetrationDepth(planSegment(m), buildable)).toBeLessThanOrEqual(1);
    }
  });
});

/** Acceptance test 4. Structure above is purlins at fixed centres. */
describe('purlins above at 1500 centres', () => {
  const result = generate({
    project: project(
      [zone({ id: 'z1', boundary: SQUARE, structureId: 'purlins' })],
      [purlins(3600, 1500, { x: 1, y: 0 })],
    ),
    registry: registry(),
  });
  const structure = purlins(3600, 1500, { x: 1, y: 0 }) as Extract<ReturnType<typeof purlins>, { spacing: number }>;
  const hangers = result.members.filter((m) => m.layerId === 'hanger');

  it('places no hanger in mid-air between purlins', () => {
    expect(hangers.length).toBeGreaterThan(0);
    const bridging = result.members.filter((m) => m.type === 'bridging');
    for (const h of hangers) {
      const onPurlin = Math.abs(h.start.y - Math.round(h.start.y / 1500) * 1500) <= structure.width / 2 + 1;
      const onBridging = bridging.some(
        (b) => closestPointOnSegment({ x: h.start.x, y: h.start.y }, planSegment(b).a, planSegment(b).b).distance <= 1,
      );
      expect(onPurlin || onBridging, `hanger at ${h.start.x},${h.start.y} has nothing to fix to`).toBe(true);
    }
  });

  it('says in the provenance that the hanger was moved to a purlin', () => {
    const moved = hangers.filter((h) => h.provenance.reason.includes('purlin'));
    expect(moved.length).toBeGreaterThan(0);
  });

  it('reports every hanger that needed a bridging member', () => {
    const bridging = result.members.filter((m) => m.type === 'bridging');
    if (bridging.length > 0) {
      expect(result.issues.some((i) => i.code === 'BRIDGING_ADDED' || i.code === 'HANGER_NEEDS_BRIDGING')).toBe(true);
      for (const b of bridging) {
        expect(b.provenance.reason).toMatch(/engineer/);
      }
    }
  });

  it('finds the purlin crossings along a member correctly', () => {
    // A member running across the purlins meets one every 1500mm.
    const crossings = structureCrossings({ a: { x: 0, y: 0 }, b: { x: 0, y: 6000 } }, structure);
    expect(crossings).toEqual([0, 1500, 3000, 4500, 6000]);
    // A member running along a purlin sits on it for its whole length.
    expect(structureCrossings({ a: { x: 0, y: 1500 }, b: { x: 4000, y: 1500 } }, structure)).toEqual([0, 4000]);
    // A member running between purlins meets none.
    expect(structureCrossings({ a: { x: 0, y: 750 }, b: { x: 4000, y: 750 } }, structure)).toEqual([]);
  });
});

/** Acceptance test 5. Change one figure in the pack and regenerate. */
describe('changing one spacing value in the rule pack', () => {
  const reg = registry();
  const before = generate({
    project: project([zone({ id: 'z1', boundary: SQUARE })]),
    registry: reg,
  });

  const reg2 = registry();
  const edited = setValueAt(reg2.get('rondo_keylock', '2026.1-example')!, 'layers.furring.maxSpacing', 300);
  reg2.register({ ...edited, version: '2026.2-example' });
  const after = generate({
    project: project([zone({ id: 'z1', boundary: SQUARE, system: { ...KEYLOCK, version: '2026.2-example' } })]),
    registry: reg2,
  });

  it('changes only the layer the figure belongs to', () => {
    const tsrBefore = before.members.filter((m) => m.layerId === 'tsr');
    const tsrAfter = after.members.filter((m) => m.layerId === 'tsr');
    const positions = (ms: Member[]) => ms.map((m) => `${m.start.x},${m.start.y}-${m.end.x},${m.end.y}`).sort();
    expect(positions(tsrAfter)).toEqual(positions(tsrBefore));

    const furringBefore = before.members.filter((m) => m.layerId === 'furring');
    const furringAfter = after.members.filter((m) => m.layerId === 'furring');
    expect(furringAfter.length).toBeGreaterThan(furringBefore.length);
  });

  it('tightens the furring to the new spacing', () => {
    // Both are the even-bay spacing derived from the maximum, so tightening the
    // maximum from 450 to 300 adds bays and closes the members up.
    expect(before.zones[0]!.spacings.furring!.spacing).toBe(411.111);
    expect(after.zones[0]!.spacings.furring!.spacing).toBe(284.615);
    expect(after.zones[0]!.spacings.furring!.spacing).toBeLessThan(300);
  });

  it('cites the new pack version on every changed member', () => {
    for (const m of after.members.filter((x) => x.layerId === 'furring')) {
      expect(m.provenance.rulePackVersion).toBe('rondo_keylock@2026.2-example');
      expect(m.provenance.spacingUsed).toBe(300);  // the maximum that governed
      expect(m.provenance.ruleId).toBe('layers.furring.maxSpacing');
    }
  });

  it('leaves the old version generating exactly what it did before', () => {
    const again = generate({ project: project([zone({ id: 'z1', boundary: SQUARE })]), registry: registry() });
    expect(JSON.stringify(again.members)).toBe(JSON.stringify(before.members));
  });
});
