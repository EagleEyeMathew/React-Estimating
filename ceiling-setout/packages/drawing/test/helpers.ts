import { circle, rectangle, ringToBoundary, type Ring } from '@ceiling/geometry';
import { builtinRegistry, type RulePack } from '@ceiling/rules';
import { generate as runEngine, type Penetration, type Project, type Zone } from '@ceiling/engine';

const SQUARE: Ring = rectangle(0, 0, 6000, 4000);

export interface Options {
  readonly withPenetrations?: boolean;
  readonly withColumn?: boolean;
  readonly raked?: boolean;
}

export function ringToBoundaryZone(ring: Ring): Zone['boundary'] {
  return ringToBoundary(ring, 1);
}

export function generate(options: Options = {}) {
  const penetrations: Penetration[] = options.withPenetrations
    ? [
        { id: 'dl1', kind: 'downlight', reference: 'DL1', shape: { kind: 'circle', centre: { x: 1500, y: 1200 }, radius: 45 } },
        { id: 'df1', kind: 'diffuser', reference: 'DF1', shape: { kind: 'rect', centre: { x: 2400, y: 1400 }, width: 600, height: 600, rotation: 0 } },
      ]
    : [];

  const zone: Zone = {
    id: 'z1',
    name: 'Zone 1',
    boundary: ringToBoundaryZone(SQUARE),
    // Clear of the diffuser at 3000,2000 so the two cases do not overlap.
    holes: options.withColumn ? [circle({ x: 4600, y: 1100 }, 400, 32)] : [],
    penetrations,
    plane: options.raked
      ? { kind: 'raked', level: 2700, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, fall: 1 / 20 }
      : { kind: 'horizontal', level: 2700 },
    structureId: 'slab',
    structureSnapTolerance: 300,
    system: { pack: 'rondo_keylock', version: '2026.1-example', loadCase: '13mm_plasterboard' },
    setout: { direction: { kind: 'longest-edge' }, origin: { kind: 'balanced' }, avoidPenetrations: true },
    disabledLayers: ['brace'],
  };

  const project: Project = {
    id: 'p1',
    name: 'Drawing test project',
    client: 'Test client',
    reference: 'TP-01',
    units: 'mm',
    levelDatum: 'FFL 0',
    structures: [{ id: 'slab', name: 'Concrete soffit', kind: 'slab', plane: { kind: 'horizontal', level: 3400 } }],
    zones: [zone],
    overrides: [],
  };

  const registry = builtinRegistry();
  const result = runEngine({ project, registry });
  const packs: RulePack[] = [registry.get('rondo_keylock', '2026.1-example')!];
  return { project, result, packs, registry };
}
