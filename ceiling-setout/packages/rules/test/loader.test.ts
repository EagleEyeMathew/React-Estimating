import { describe, expect, it } from 'vitest';
import { builtinPackJson, builtinPacks, builtinRegistry, provenanceBanner } from '../src/builtin.js';
import { hasErrors, loadRulePack, packKey } from '../src/loader.js';
import { readiness, valueSlots } from '../src/paths.js';
import { sectionOutline } from '@ceiling/geometry';
import rondoKeylock from '../packs/rondo_keylock.2026.1.json';

describe('shipped packs', () => {
  const packs = builtinPacks();

  it('all parse and cross-check cleanly', () => {
    for (const raw of [rondoKeylock]) {
      const { pack, problems } = loadRulePack(raw);
      expect(pack).not.toBeNull();
      expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    }
    expect(packs.length).toBeGreaterThanOrEqual(7);
  });

  it('ships with no problems at all, not merely no errors', () => {
    // Warnings included: an uncited value or a section that disagrees with the size
    // entered beside it are exactly the things that should never ship unnoticed.
    const problems = builtinPackJson.flatMap((raw) => {
      const { pack, problems } = loadRulePack(raw);
      return problems.map((p) => `${pack?.system}@${pack?.version} ${p.severity} ${p.code} ${p.path}: ${p.message}`);
    });
    expect(problems).toEqual([]);
  });

  it('draws every section it claims to, at the size catalogued beside it', () => {
    for (const pack of packs) {
      for (const product of pack.catalogue) {
        if (!product.profile) continue;
        const section = sectionOutline(product.profile);
        expect(section, `${pack.system} ${product.code}`).not.toBeNull();
        if (product.width !== null) expect(section!.width).toBeCloseTo(product.width, -0.5);
        if (product.depth !== null) expect(section!.depth).toBeCloseTo(product.depth, -0.5);
      }
    }
  });

  it('ships skeletons with every figure blank', () => {
    for (const pack of packs.filter((p) => p.status === 'skeleton')) {
      const entered = valueSlots(pack).filter((s) => s.value !== null);
      expect(entered, `${packKey(pack)} should have no values entered`).toEqual([]);
      expect(readiness(pack).generatable).toBe(false);
    }
  });

  it('marks example packs so their output can never pass as real', () => {
    const examples = packs.filter((p) => p.status === 'example');
    expect(examples.length).toBeGreaterThan(0);
    for (const pack of examples) {
      expect(readiness(pack).generatable).toBe(true);
      expect(provenanceBanner(pack)).toMatch(/INVENTED EXAMPLE DATA/);
      expect(pack.notes ?? '').toMatch(/INVENTED/);
      // Every entered figure cites the example source, not a manufacturer.
      for (const slot of valueSlots(pack).filter((s) => s.value !== null)) {
        expect(slot.citation?.source, slot.path).toMatch(/EXAMPLE DATA/);
      }
    }
  });

  it('always states that structural verification stays with the engineer', () => {
    for (const pack of packs) {
      expect(provenanceBanner(pack)).toMatch(/engineer/);
    }
  });
});

describe('pack validation', () => {
  const base = () => structuredClone(rondoKeylock) as Record<string, unknown>;

  it('rejects a layer that bears on a layer that does not exist', () => {
    const p = base();
    (p.layers as { id: string; supportedBy?: string }[])[0]!.supportedBy = 'nonexistent';
    const { problems } = loadRulePack(p);
    expect(problems.some((x) => x.code === 'UNKNOWN_LAYER_REF')).toBe(true);
    expect(hasErrors(problems)).toBe(true);
  });

  it('rejects a support cycle', () => {
    const p = base();
    const layers = p.layers as { id: string; supportedBy?: string | null }[];
    layers.find((l) => l.id === 'furring')!.supportedBy = 'tsr';
    layers.find((l) => l.id === 'tsr')!.supportedBy = 'furring';
    const { problems } = loadRulePack(p);
    expect(problems.some((x) => x.code === 'SUPPORT_CYCLE')).toBe(true);
  });

  it('rejects a product code with nothing behind it', () => {
    const p = base();
    (p.layers as { product?: string | null }[])[0]!.product = 'NOT-A-PRODUCT';
    const { problems } = loadRulePack(p);
    expect(problems.some((x) => x.code === 'UNKNOWN_PRODUCT_REF')).toBe(true);
  });

  it('warns when a product is used in a role it is not catalogued for', () => {
    const p = base();
    (p.layers as { id: string; product?: string | null }[]).find((l) => l.id === 'furring')!.product = '130';
    const { problems } = loadRulePack(p);
    expect(problems.some((x) => x.code === 'PRODUCT_ROLE_MISMATCH' && x.severity === 'warning')).toBe(true);
  });

  it('refuses a pack marked verified while values are still blank', () => {
    const p = base();
    p.status = 'verified';
    const { problems } = loadRulePack(p);
    expect(problems.some((x) => x.code === 'VERIFIED_BUT_INCOMPLETE')).toBe(true);
  });

  it('rejects a system name that is not a slug', () => {
    const p = base();
    p.system = 'Rondo KEY-LOCK';
    const { problems } = loadRulePack(p);
    expect(hasErrors(problems)).toBe(true);
  });

  it('rejects a negative spacing outright', () => {
    const p = base();
    (p.layers as { maxSpacing?: number | null }[])[0]!.maxSpacing = -450;
    expect(hasErrors(loadRulePack(p).problems)).toBe(true);
  });
});

describe('registry', () => {
  it('keeps versions side by side so old projects regenerate identically', () => {
    const r = builtinRegistry();
    expect(r.versionsOf('rondo_keylock')).toEqual(['2026.1', '2026.1-example']);
    expect(r.get('rondo_keylock', '2026.1')!.status).toBe('skeleton');
    expect(r.get('rondo_keylock', '2026.1-example')!.status).toBe('example');
    expect(r.get('rondo_keylock', '2099.9')).toBeNull();
  });

  it('lists the systems it holds', () => {
    expect(builtinRegistry().systems()).toEqual([
      'nvelope_rail',
      'rondo_furring_directfix',
      'rondo_keylock',
      'sculptform_batten',
      'tbar_grid',
    ]);
  });
});
