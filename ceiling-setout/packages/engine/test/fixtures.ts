import { circle, rectangle, ringToBoundary, type Ring, type Vec2 } from '@ceiling/geometry';
import { builtinRegistry, type RulePackRegistry } from '@ceiling/rules';
import type { Penetration, Project, Structure, Zone } from '../src/project.js';

export const registry = (): RulePackRegistry => builtinRegistry();

export const KEYLOCK = { pack: 'rondo_keylock', version: '2026.1-example', loadCase: '13mm_plasterboard' };
export const TBAR = { pack: 'tbar_grid', version: '2026.1-example', loadCase: 'standard_tile' };

export const slab = (level = 3400, id = 'slab'): Structure => ({
  id,
  name: 'Concrete soffit',
  kind: 'slab',
  plane: { kind: 'horizontal', level },
});

export const purlins = (
  level = 3600,
  spacing = 1500,
  direction: Vec2 = { x: 1, y: 0 },
  id = 'purlins',
): Structure => ({
  id,
  name: 'Steel purlins',
  kind: 'purlins',
  plane: { kind: 'horizontal', level },
  direction,
  spacing,
  offset: 0,
  width: 75,
});

export function zone(overrides: Omit<Partial<Zone>, 'boundary'> & { id: string; boundary: Ring }): Zone {
  const { boundary, ...rest } = overrides;
  return {
    name: rest.name ?? rest.id,
    boundary: ringToBoundary(boundary, 1),
    holes: [],
    penetrations: [],
    plane: { kind: 'horizontal', level: 2700 },
    structureId: 'slab',
    structureSnapTolerance: 300,
    system: KEYLOCK,
    setout: {
      direction: { kind: 'longest-edge' },
      origin: { kind: 'balanced' },
      avoidPenetrations: true,
    },
    disabledLayers: ['brace'],
    ...rest,
  } as Zone;
}

export function project(zones: Zone[], structures: Structure[] = [slab()], overrides: Project['overrides'] = []): Project {
  return {
    id: 'p1',
    name: 'Test project',
    client: null,
    reference: null,
    units: 'mm',
    levelDatum: 'FFL 0',
    structures,
    zones,
    overrides,
  };
}

/** A plain 6m x 4m room. */
export const SQUARE: Ring = rectangle(0, 0, 6000, 4000);

/** The L-shaped reference room: 8m x 4m arm and a 4m x 5m arm. */
export const L_ROOM: Ring = [
  { x: 0, y: 0 },
  { x: 8000, y: 0 },
  { x: 8000, y: 4000 },
  { x: 4000, y: 4000 },
  { x: 4000, y: 9000 },
  { x: 0, y: 9000 },
];

/**
 * The L-room with its long wall raked over by 7 degrees, which is the acceptance
 * case: nothing in the pipeline may square it back up.
 */
export function skewLRoom(degrees = 7): Ring {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return L_ROOM.map((p) => ({ x: Math.round(p.x * c - p.y * s), y: Math.round(p.x * s + p.y * c) }));
}

export const column = (centre: Vec2, radius = 300): Ring => circle(centre, radius, 32);

export function downlight(id: string, centre: Vec2, radius = 45): Penetration {
  return { id, kind: 'downlight', reference: id.toUpperCase(), shape: { kind: 'circle', centre, radius } };
}

export function diffuser(id: string, centre: Vec2, size = 600): Penetration {
  return {
    id,
    kind: 'diffuser',
    reference: id.toUpperCase(),
    shape: { kind: 'rect', centre, width: size, height: size, rotation: 0 },
  };
}
