import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import {
  L_ROOM,
  SQUARE,
  TBAR,
  column,
  diffuser,
  downlight,
  project,
  purlins,
  registry,
  skewLRoom,
  zone,
} from './fixtures.js';
import type { GenerationResult } from '../src/types.js';

/**
 * A library of reference rooms, snapshotted.
 *
 * These exist to make an unintended change loud. Any edit to the pipeline that moves
 * a member, renames an identity or alters a count shows up here as a diff to read
 * rather than as a surprise on a drawing three weeks later.
 */
const summarise = (r: GenerationResult) => ({
  members: r.members.length,
  byLayer: Object.fromEntries(
    [...new Set(r.members.map((m) => m.layerId))]
      .sort()
      .map((l) => [l, r.members.filter((m) => m.layerId === l).length]),
  ),
  totalCutLength: Math.round(r.members.reduce((s, m) => s + m.length, 0)),
  spacings: r.zones.map((z) => z.spacings),
  setout: r.zones.map((z) => ({
    degrees: z.setout.directionDegrees,
    reason: z.setout.directionReason,
    origin: z.setout.origin,
  })),
  issues: r.issues.map((i) => `${i.severity} ${i.code}`).sort(),
});

const cases: Record<string, () => GenerationResult> = {
  'plain 6x4 room': () => generate({ project: project([zone({ id: 'z1', boundary: SQUARE })]), registry: registry() }),

  'L-shaped room': () => generate({ project: project([zone({ id: 'z1', boundary: L_ROOM })]), registry: registry() }),

  'L-shaped room skewed 7 degrees with two columns': () =>
    generate({
      project: project([
        zone({
          id: 'z1',
          boundary: skewLRoom(7),
          holes: [column({ x: 1500, y: 1500 }, 300), column({ x: 2600, y: 5200 }, 250)],
        }),
      ]),
      registry: registry(),
    }),

  'raked 1:20': () =>
    generate({
      project: project([
        zone({
          id: 'z1',
          boundary: SQUARE,
          plane: { kind: 'raked', level: 2700, origin: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, fall: 1 / 20 },
        }),
      ]),
      registry: registry(),
    }),

  'services: 14 downlights and 3 diffusers': () =>
    generate({
      project: project([
        zone({
          id: 'z1',
          boundary: SQUARE,
          penetrations: [
            ...Array.from({ length: 14 }, (_, i) =>
              downlight(`dl${i + 1}`, { x: 600 + (i % 7) * 800, y: 900 + Math.floor(i / 7) * 2200 }),
            ),
            diffuser('df1', { x: 1500, y: 2000 }),
            diffuser('df2', { x: 3000, y: 2000 }),
            diffuser('df3', { x: 4500, y: 2000 }),
          ],
        }),
      ]),
      registry: registry(),
    }),

  'purlins above at 1500 centres': () =>
    generate({
      project: project([zone({ id: 'z1', boundary: SQUARE, structureId: 'purlins' })], [purlins(3600, 1500)]),
      registry: registry(),
    }),

  'exposed T-bar grid': () =>
    generate({
      project: project([zone({ id: 'z1', boundary: SQUARE, system: TBAR })]),
      registry: registry(),
    }),
};

describe('reference rooms', () => {
  for (const [name, build] of Object.entries(cases)) {
    it(name, () => {
      expect(summarise(build())).toMatchSnapshot();
    });

    it(`${name} - regenerates byte-identically`, () => {
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    });
  }
});
