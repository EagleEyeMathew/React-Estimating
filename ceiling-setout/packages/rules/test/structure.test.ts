import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addLoadCase,
  addProduct,
  blankLayer,
  blankProduct,
  builtinRegistry,
  duplicateLayer,
  layerReferences,
  layersRemovedWith,
  loadRulePack,
  moveLayer,
  productReferences,
  removeLayer,
  removeLoadCase,
  removeProduct,
  renameLayer,
  updateProduct,
  updateLayer,
  valueSlots,
  type RulePack,
} from '../src/index.js';

const keylock = (): RulePack => builtinRegistry().get('rondo_keylock', '2026.1-example')!;
const flexistrut = (): RulePack => builtinRegistry().get('rondo_flexistrut', '2026.1')!;

/** A structural edit that leaves the pack loading with problems is a broken edit. */
const expectClean = (pack: RulePack): void => {
  const { problems } = loadRulePack(pack);
  expect(problems.map((p) => `${p.severity} ${p.code} ${p.path}: ${p.message}`)).toEqual([]);
};

describe('adding a layer', () => {
  it('adds a rail that starts blank, so it will not generate on a guess', () => {
    const rail = blankLayer('line-array', 'secondary_rail', 'Secondary rail', 'rail');
    const pack = addLayer(keylock(), rail, 'tsr');
    expectClean(pack);
    expect(pack.layers.map((l) => l.id)).toContain('secondary_rail');
    // Straight after the layer it was inserted behind.
    expect(pack.layers.findIndex((l) => l.id === 'secondary_rail')).toBe(
      pack.layers.findIndex((l) => l.id === 'tsr') + 1,
    );
    const figures = valueSlots(pack).filter((s) => s.path.startsWith('layers.secondary_rail.'));
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.every((f) => f.value === null)).toBe(true);
  });

  it('gives every load case a limits row for it', () => {
    const pack = addLayer(keylock(), blankLayer('line-array', 'secondary_rail', 'Secondary rail', 'rail'));
    for (const c of pack.loadCases) {
      expect(c.limits.some((l) => l.layerId === 'secondary_rail'), c.id).toBe(true);
    }
    expect(valueSlots(pack).map((s) => s.path)).toContain(
      'loadCases.13mm_plasterboard.limits.secondary_rail.maxSpan',
    );
  });

  it('refuses a duplicate id', () => {
    expect(() => addLayer(keylock(), blankLayer('line-array', 'tsr', 'Another', 'tsr'))).toThrow(/already in/);
  });

  it('adds a second stage of suspension by wiring a rod between two layers', () => {
    let pack = addLayer(keylock(), blankLayer('line-array', 'strut', 'Primary strut', 'rail'), 'tsr');
    pack = addLayer(pack, blankLayer('along-member', 'upper_rod', 'Rod to the strut', 'hanger', { along: 'strut' }));
    pack = updateLayer(pack, 'hanger', { hangsFrom: 'strut' });
    expectClean(pack);
    const hanger = pack.layers.find((l) => l.id === 'hanger')!;
    expect(hanger.generator === 'along-member' && hanger.hangsFrom).toBe('strut');
  });
});

describe('removing a layer', () => {
  it('lists everything that names it', () => {
    const refs = layerReferences(keylock(), 'tsr');
    expect(refs.map((r) => r.field).sort()).toEqual(['along', 'atCrossingsWith', 'supportedBy']);
    for (const r of refs) expect(r.description.length).toBeGreaterThan(5);
  });

  it('refuses while something still bears on it, rather than quietly detaching', () => {
    expect(() => removeLayer(keylock(), 'tsr')).toThrow(/cannot be removed while 3 thing\(s\) name it/);
  });

  it('says which layers cannot survive without it', () => {
    // The hanger runs along the rail and the clip is placed at crossings with it; only
    // the hanger cannot exist without it, because it has nothing else to sit on.
    expect(layersRemovedWith(keylock(), 'tsr')).toEqual(['hanger']);
    expect(layersRemovedWith(keylock(), 'furring')).toEqual(['clip']);
    expect(layersRemovedWith(keylock(), 'wall_angle')).toEqual([]);
  });

  it('detaches on request, taking the layers that cannot survive without it', () => {
    const pack = removeLayer(keylock(), 'tsr', { detach: true });
    expectClean(pack);
    expect(pack.layers.some((l) => l.id === 'tsr')).toBe(false);
    // The hanger ran along it, so it went too.
    expect(pack.layers.some((l) => l.id === 'hanger')).toBe(false);
    const furring = pack.layers.find((l) => l.id === 'furring')!;
    expect(furring.generator === 'line-array' && furring.supportedBy).toBeNull();
    // The load case limits and the citations went with it.
    for (const c of pack.loadCases) expect(c.limits.some((l) => l.layerId === 'tsr')).toBe(false);
    expect(Object.keys(pack.citations).some((k) => k.startsWith('layers.tsr.'))).toBe(false);
  });

  it('removes an unreferenced layer without argument', () => {
    const pack = removeLayer(keylock(), 'wall_angle');
    expectClean(pack);
    expect(pack.layers.some((l) => l.id === 'wall_angle')).toBe(false);
  });

  it('clears the penetration trimmer when that layer goes', () => {
    const pack = removeLayer(keylock(), 'furring', { detach: true });
    expect(pack.penetration!.trimmerLayer).toBeNull();
    expectClean(pack);
  });

  it('unwires a hangsFrom when the layer above is removed', () => {
    const pack = removeLayer(flexistrut(), 'strut', { detach: true });
    expectClean(pack);
    const lower = pack.layers.find((l) => l.id === 'lower_rod')!;
    expect(lower.generator === 'along-member' && lower.hangsFrom).toBeNull();
  });
});

describe('renaming a layer', () => {
  it('rewrites every reference, limit and citation', () => {
    const pack = renameLayer(keylock(), 'tsr', 'top_cross_rail');
    expectClean(pack);
    const furring = pack.layers.find((l) => l.id === 'furring')!;
    expect(furring.generator === 'line-array' && furring.supportedBy).toBe('top_cross_rail');
    const hanger = pack.layers.find((l) => l.id === 'hanger')!;
    expect(hanger.generator === 'along-member' && hanger.along).toBe('top_cross_rail');
    const clip = pack.layers.find((l) => l.id === 'clip')!;
    expect(clip.generator === 'along-member' && clip.atCrossingsWith).toBe('top_cross_rail');
    for (const c of pack.loadCases) {
      expect(c.limits.some((l) => l.layerId === 'top_cross_rail')).toBe(true);
      expect(c.limits.some((l) => l.layerId === 'tsr')).toBe(false);
    }
    expect(pack.citations['layers.top_cross_rail.maxSpacing']).toBeDefined();
    expect(pack.citations['layers.tsr.maxSpacing']).toBeUndefined();
  });

  it('refuses a name already taken', () => {
    expect(() => renameLayer(keylock(), 'tsr', 'furring')).toThrow(/already exists/);
  });
});

describe('duplicating a layer', () => {
  it('copies the figures and their sources', () => {
    const pack = duplicateLayer(keylock(), 'tsr', 'tsr_upper', 'Upper top cross rail');
    expectClean(pack);
    const original = valueSlots(keylock()).find((s) => s.path === 'layers.tsr.maxSpacing')!;
    const copy = valueSlots(pack).find((s) => s.path === 'layers.tsr_upper.maxSpacing')!;
    expect(copy.value).toBe(original.value);
    expect(copy.citation?.source).toBe(original.citation?.source);
  });
});

describe('the catalogue', () => {
  it('adds a custom product and puts a layer on it', () => {
    let pack = addProduct(keylock(), blankProduct('EED-RAIL-40', 'Custom 40mm rail', ['rail', 'tsr']));
    pack = addLayer(pack, blankLayer('line-array', 'custom_rail', 'Custom rail', 'rail'));
    pack = updateLayer(pack, 'custom_rail', { product: 'EED-RAIL-40' });
    expectClean(pack);
    expect(pack.catalogue.some((p) => p.code === 'EED-RAIL-40')).toBe(true);
    expect(valueSlots(pack).map((s) => s.path)).toContain('catalogue.EED-RAIL-40.depth');
  });

  it('refuses to remove a product a layer is made from', () => {
    expect(() => removeProduct(keylock(), '308')).toThrow(/cannot be removed while/);
    expect(productReferences(keylock(), '308').map((r) => r.field)).toContain('product');
  });

  it('detaches a removed product from every layer that used it', () => {
    const pack = removeProduct(keylock(), '129', { detach: true });
    expectClean(pack);
    for (const l of pack.layers) {
      expect(l.product).not.toBe('129');
      expect(l.alternativeProducts).not.toContain('129');
    }
  });

  it('refuses to rename a product code, which would orphan its layers', () => {
    expect(() => updateProduct(keylock(), '308', { code: 'NEW' })).toThrow(/orphan/);
  });
});

describe('load cases', () => {
  it('adds one with a row for every layer', () => {
    const pack = addLoadCase(keylock(), 'acoustic', 'Acoustic lining');
    expectClean(pack);
    const added = pack.loadCases.find((c) => c.id === 'acoustic')!;
    expect(added.limits.map((l) => l.layerId).sort()).toEqual(pack.layers.map((l) => l.id).sort());
  });

  it('removes one and its citations', () => {
    const pack = removeLoadCase(keylock(), '13mm_plasterboard');
    expectClean(pack);
    expect(pack.loadCases.some((c) => c.id === '13mm_plasterboard')).toBe(false);
    expect(Object.keys(pack.citations).some((k) => k.startsWith('loadCases.13mm_plasterboard.'))).toBe(false);
  });
});

describe('reordering', () => {
  it('moves a layer without disturbing anything else', () => {
    const before = keylock().layers.map((l) => l.id);
    const pack = moveLayer(keylock(), 'hanger', -2);
    expectClean(pack);
    expect(pack.layers.map((l) => l.id).sort()).toEqual([...before].sort());
    expect(pack.layers.findIndex((l) => l.id === 'hanger')).toBeLessThan(before.indexOf('hanger'));
  });
});

describe('edits never touch the original', () => {
  it('leaves the pack it was given alone', () => {
    const original = keylock();
    const snapshot = JSON.stringify(original);
    addLayer(original, blankLayer('line-array', 'x', 'x', 'rail'));
    removeLayer(original, 'wall_angle');
    renameLayer(original, 'tsr', 'renamed');
    addProduct(original, blankProduct('X', 'x', ['rail']));
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});
