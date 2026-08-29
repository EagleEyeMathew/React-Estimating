import { circle, rectangle, ringToBoundary } from '@ceiling/geometry';
import type { Penetration, Project, Zone } from '@ceiling/engine';

/**
 * A demo project that exercises the awkward cases rather than a tidy rectangle: a
 * concave outline with a skew wall, a round column, a rake, and a services layout.
 * Opening the app on a 6x4 box would leave the parts that matter untested by eye.
 */

const OFFICE: Zone['boundary'] = ringToBoundary(
  [
    { x: 0, y: 0 },
    { x: 9000, y: 0 },
    { x: 9200, y: 4200 },
    { x: 4600, y: 4400 },
    { x: 4600, y: 9000 },
    { x: 0, y: 9000 },
  ],
  1,
);

function grid(prefix: string, xs: number[], ys: number[], radius = 45): Penetration[] {
  const out: Penetration[] = [];
  let i = 1;
  for (const y of ys) {
    for (const x of xs) {
      out.push({
        id: `${prefix}${i}`,
        kind: 'downlight',
        reference: `${prefix.toUpperCase()}${i}`,
        shape: { kind: 'circle', centre: { x, y }, radius },
      });
      i++;
    }
  }
  return out;
}

export function demoProject(): Project {
  const openPlan: Zone = {
    id: 'open-plan',
    name: 'Open plan office',
    boundary: OFFICE,
    holes: [circle({ x: 6600, y: 2100 }, 300, 32)],
    penetrations: [
      ...grid('dl', [1200, 2400, 3500, 6000, 7200, 8400], [1200, 2400]),
      ...grid('dl', [1200, 2400, 3600], [6000, 7200]),
      {
        id: 'df1',
        kind: 'diffuser',
        reference: 'DF1',
        shape: { kind: 'rect', centre: { x: 2400, y: 4000 }, width: 600, height: 600, rotation: 0 },
      },
      {
        id: 'df2',
        kind: 'diffuser',
        reference: 'DF2',
        shape: { kind: 'rect', centre: { x: 7500, y: 3200 }, width: 600, height: 600, rotation: 0 },
      },
      {
        id: 'ap1',
        kind: 'access_panel',
        reference: 'AP1',
        shape: { kind: 'rect', centre: { x: 1000, y: 8200 }, width: 600, height: 600, rotation: 0 },
      },
    ],
    plane: { kind: 'horizontal', level: 2700 },
    structureId: 'slab',
    structureSnapTolerance: 300,
    system: { pack: 'rondo_keylock', version: '2026.1-example', loadCase: '13mm_plasterboard' },
    setout: { direction: { kind: 'longest-edge' }, origin: { kind: 'balanced' }, avoidPenetrations: true },
    disabledLayers: ['brace'],
  };

  const meeting: Zone = {
    id: 'meeting',
    name: 'Meeting room (raked 1:20)',
    boundary: ringToBoundary(rectangle(10000, 0, 15000, 4500), 1),
    holes: [],
    penetrations: grid('ml', [11000, 12500, 14000], [1500, 3000]),
    plane: { kind: 'raked', level: 2700, origin: { x: 10000, y: 0 }, direction: { x: 1, y: 0 }, fall: 1 / 20 },
    structureId: 'purlins',
    structureSnapTolerance: 400,
    system: { pack: 'rondo_keylock', version: '2026.1-example', loadCase: '13mm_plasterboard' },
    setout: { direction: { kind: 'longest-edge' }, origin: { kind: 'balanced' }, avoidPenetrations: true },
    disabledLayers: ['brace'],
  };

  const reception: Zone = {
    id: 'reception',
    name: 'Reception (exposed grid)',
    boundary: ringToBoundary(rectangle(10000, 5200, 15000, 9000), 1),
    holes: [],
    penetrations: [
      {
        id: 'rdf1',
        kind: 'diffuser',
        reference: 'RDF1',
        shape: { kind: 'rect', centre: { x: 12500, y: 7100 }, width: 600, height: 600, rotation: 0 },
      },
    ],
    plane: { kind: 'horizontal', level: 2700 },
    structureId: 'slab',
    structureSnapTolerance: 300,
    system: { pack: 'tbar_grid', version: '2026.1-example', loadCase: 'standard_tile' },
    setout: { direction: { kind: 'longest-edge' }, origin: { kind: 'balanced' }, avoidPenetrations: false },
    disabledLayers: [],
  };

  return {
    id: 'demo',
    name: 'Demonstration project',
    client: 'Eagle Eye Drafting',
    reference: 'DEMO-01',
    units: 'mm',
    levelDatum: 'FFL 0',
    structures: [
      { id: 'slab', name: 'Concrete soffit', kind: 'slab', plane: { kind: 'horizontal', level: 3600 } },
      {
        id: 'purlins',
        name: 'Steel purlins at 1500',
        kind: 'purlins',
        plane: { kind: 'horizontal', level: 3900 },
        // Across the top cross rails, which is the only arrangement a hanger can fix
        // to: purlins running the same way as the rails leave every hanger between two
        // of them.
        direction: { x: 1, y: 0 },
        spacing: 1500,
        offset: 0,
        width: 75,
      },
    ],
    zones: [openPlan, meeting, reception],
    overrides: [],
  };
}
