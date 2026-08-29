import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import { applyOverrides } from '../src/overrides.js';
import type { Override } from '../src/project.js';
import { L_ROOM, SQUARE, project, registry, zone } from './fixtures.js';

const base = () => generate({ project: project([zone({ id: 'z1', boundary: SQUARE })]), registry: registry() });

const withOverrides = (overrides: Override[]) =>
  generate({ project: project([zone({ id: 'z1', boundary: SQUARE })], undefined, overrides), registry: registry() });

describe('manual overrides', () => {
  const first = base();
  const target = first.members.find((m) => m.layerId === 'furring')!;

  it('deletes a member the user removed', () => {
    const after = withOverrides([{ kind: 'delete', memberId: target.id, note: 'clashes with duct' }]);
    expect(after.members.find((m) => m.id === target.id)).toBeUndefined();
    expect(after.members.length).toBe(first.members.length - 1);
  });

  it('moves a member and records why in its provenance', () => {
    const after = withOverrides([{ kind: 'move', memberId: target.id, delta: { x: 0, y: 75 }, note: null }]);
    const moved = after.members.find((m) => m.id === target.id)!;
    expect(moved.start.y).toBe(target.start.y + 75);
    expect(moved.end.y).toBe(target.end.y + 75);
    expect(moved.overridden).toBe('moved');
    expect(moved.provenance.reason).toMatch(/moved 75mm by hand/);
  });

  it('retrims a member and shortens its cut length', () => {
    const after = withOverrides([{ kind: 'retrim', memberId: target.id, trimStart: 100, trimEnd: 200, note: null }]);
    const trimmed = after.members.find((m) => m.id === target.id)!;
    expect(trimmed.planLength).toBe(target.planLength - 300);
    expect(trimmed.start.x).toBe(target.start.x + 100);
    expect(trimmed.overridden).toBe('retrimmed');
  });

  it('swaps a product without touching the geometry', () => {
    const after = withOverrides([{ kind: 'product', memberId: target.id, productCode: '129', note: null }]);
    const swapped = after.members.find((m) => m.id === target.id)!;
    expect(swapped.productCode).toBe('129');
    expect(swapped.start).toEqual(target.start);
  });

  /**
   * The point of the identity scheme: an edit made before a change elsewhere in the
   * zone must still find its member afterwards.
   */
  it('survives a change at the other end of the zone', () => {
    const overrides: Override[] = [{ kind: 'move', memberId: target.id, delta: { x: 0, y: 40 }, note: null }];
    const widened = generate({
      project: project(
        [zone({ id: 'z1', boundary: [...SQUARE.slice(0, 1), { x: 9000, y: 0 }, { x: 9000, y: 4000 }, ...SQUARE.slice(3)] })],
        undefined,
        overrides,
      ),
      registry: registry(),
    });
    const moved = widened.members.find((m) => m.id === target.id);
    expect(moved, 'the edit lost its member when the room got longer').toBeDefined();
    expect(moved!.overridden).toBe('moved');
    expect(widened.orphanedOverrides).toEqual([]);
  });

  it('reports an edit whose member has genuinely gone, rather than dropping it', () => {
    const gone = generate({
      project: project([zone({ id: 'z1', boundary: L_ROOM })], undefined, [
        { kind: 'move', memberId: 'z1:furring:L999.0', delta: { x: 0, y: 10 }, note: null },
      ]),
      registry: registry(),
    });
    expect(gone.orphanedOverrides).toEqual(['z1:furring:L999.0']);
    const issue = gone.issues.find((i) => i.code === 'OVERRIDE_ORPHANED');
    expect(issue?.message).toMatch(/has not been applied/);
  });

  it('applies several edits to the same member in order', () => {
    const { members } = applyOverrides(first.members, [
      { kind: 'move', memberId: target.id, delta: { x: 0, y: 10 }, note: null },
      { kind: 'product', memberId: target.id, productCode: '129', note: null },
    ]);
    const m = members.find((x) => x.id === target.id)!;
    expect(m.start.y).toBe(target.start.y + 10);
    expect(m.productCode).toBe('129');
  });
});
