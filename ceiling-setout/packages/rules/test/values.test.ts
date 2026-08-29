import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '../src/builtin.js';
import { PackReader, resolveSpacing, resolveSpan } from '../src/values.js';
import { setValueAt } from '../src/edit.js';
import type { RulePack } from '../src/schema.js';

const registry = builtinRegistry();
const example = (): RulePack => registry.get('rondo_keylock', '2026.1-example')!;
const skeleton = (): RulePack => registry.get('rondo_keylock', '2026.1')!;
const tbar = (): RulePack => registry.get('tbar_grid', '2026.1-example')!;

describe('spacing resolution', () => {
  it('takes the tightest of the layer maximum and the load case limit', () => {
    const r = new PackReader(example(), '2x13mm_plasterboard');
    const furring = resolveSpacing(r, 'furring');
    // Layer max is 450, the heavier load case says 400.
    expect(furring.spacing).toBe(400);
    expect(furring.governedBy).toBe('loadCases.2x13mm_plasterboard.limits.furring.maxSpacing');
  });

  it('caps a supporting layer by the allowable span of what it carries', () => {
    const r = new PackReader(example(), '13mm_plasterboard');
    const tsr = resolveSpacing(r, 'tsr');
    // TSR could sit at 1200 on its own, and the furring it carries spans 1200 - so 1200.
    expect(tsr.spacing).toBe(1200);
    expect(tsr.candidates.map((c) => c.path)).toContain('loadCases.13mm_plasterboard.limits.furring.maxSpan');
  });

  it('tightens the supporting layer when the lining gets heavier', () => {
    const r = new PackReader(example(), '2x13mm_plasterboard');
    const tsr = resolveSpacing(r, 'tsr');
    // Furring now only spans 900, so the TSRs must come in to 900.
    expect(tsr.spacing).toBe(900);
    expect(tsr.governedBy).toBe('loadCases.2x13mm_plasterboard.limits.furring.maxSpan');
  });

  it('records every constraint it weighed, not only the binding one', () => {
    const r = new PackReader(example(), '13mm_plus_insulation');
    const tsr = resolveSpacing(r, 'tsr');
    expect(tsr.candidates.map((c) => c.path).sort()).toEqual([
      'layers.tsr.maxSpacing',
      'loadCases.13mm_plus_insulation.limits.furring.maxSpan',
      'loadCases.13mm_plus_insulation.limits.tsr.maxSpacing',
    ]);
    expect(tsr.spacing).toBe(1050);
  });

  it('carries the citation of the binding value through', () => {
    const r = new PackReader(example(), '13mm_plasterboard');
    expect(resolveSpacing(r, 'furring').citation?.source).toMatch(/EXAMPLE DATA/);
  });

  it('reports a blank figure instead of substituting a default', () => {
    const r = new PackReader(skeleton(), '13mm_plasterboard');
    const furring = resolveSpacing(r, 'furring');
    expect(furring.spacing).toBeNull();
    expect(r.missing.map((m) => m.path)).toContain('layers.furring.maxSpacing');
  });

  it('reports an unknown load case rather than silently ignoring it', () => {
    const r = new PackReader(example(), 'not_a_load_case');
    expect(r.loadCase).toBeNull();
    expect(r.missing.some((m) => m.path === 'loadCases.not_a_load_case')).toBe(true);
  });

  it('treats a fixed module as a module, not a spacing to be reduced', () => {
    const r = new PackReader(tbar(), 'heavy_tile');
    const main = resolveSpacing(r, 'main_tee');
    // Main tee spacing is the cross tee span, and heavy tile drops that to 900 - but
    // the 1200 tile module is what the ceiling looks like, so it stays at 1200.
    expect(main.spacing).toBe(1200);
    expect(main.module).toBe(1200);
    expect(main.governedBy).toBe('layers.main_tee.module');
    // ...and says so, so the validator can raise it rather than the drawing hiding it.
    expect(main.moduleExceedsLimit).toBe(true);
  });

  it('does not flag a module that sits inside its limits', () => {
    const r = new PackReader(tbar(), 'standard_tile');
    expect(resolveSpacing(r, 'main_tee').moduleExceedsLimit).toBe(false);
  });

  it('resolves spans from the load case', () => {
    const r = new PackReader(example(), '13mm_plasterboard');
    expect(resolveSpan(r, 'furring')?.value).toBe(1200);
    expect(resolveSpan(r, 'wall_angle')).toBeNull();
  });
});

describe('editing a pack', () => {
  it('writes a value through its path', () => {
    const edited = setValueAt(example(), 'layers.furring.maxSpacing', 300);
    const r = new PackReader(edited, '13mm_plasterboard');
    expect(resolveSpacing(r, 'furring').spacing).toBe(300);
    expect(resolveSpacing(r, 'furring').governedBy).toBe('layers.furring.maxSpacing');
  });

  it('leaves the original pack untouched', () => {
    const original = example();
    setValueAt(original, 'layers.furring.maxSpacing', 300);
    expect(new PackReader(original, '13mm_plasterboard').layer('furring')).toMatchObject({ maxSpacing: 450 });
  });

  it('clears a value back to blank', () => {
    const edited = setValueAt(example(), 'loadCases.13mm_plasterboard.limits.furring.maxSpan', null);
    const r = new PackReader(edited, '13mm_plasterboard');
    expect(resolveSpan(r, 'furring')).toBeNull();
    expect(resolveSpacing(r, 'tsr').spacing).toBe(1200);
  });

  it('refuses a path that is not an editable figure', () => {
    expect(() => setValueAt(example(), 'layers.furring.nonsense', 1)).toThrow(/no editable value/);
    expect(() => setValueAt(example(), 'layers.no_such_layer.maxSpacing', 1)).toThrow();
  });
});
