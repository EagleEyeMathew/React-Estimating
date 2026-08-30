import type { Citation, Layer, MemberType, Product, RulePack } from './schema.js';
import { layerSchema, productSchema } from './schema.js';
import { valueSlots } from './paths.js';

/**
 * Write a figure into a pack by its dotted path, returning a new pack.
 *
 * The editor works in paths so the UI never has to know the shape of the schema, and
 * so the same path identifies the value in the pack, in its citation, and in the
 * provenance of every member the value produced.
 */
export function setValueAt(pack: RulePack, path: string, value: number | null): RulePack {
  const parts = path.split('.');
  const next: RulePack = structuredClone(pack);

  const fail = (): never => {
    throw new Error(`no editable value at path "${path}" in ${pack.system}@${pack.version}`);
  };

  switch (parts[0]) {
    case 'catalogue': {
      const p = next.catalogue.find((c) => c.code === parts[1]);
      if (!p) fail();
      const field = parts[2] as 'massPerMetre' | 'depth' | 'width';
      if (!['massPerMetre', 'depth', 'width'].includes(field)) fail();
      p![field] = value;
      break;
    }
    case 'loadCases': {
      const c = next.loadCases.find((x) => x.id === parts[1]);
      if (!c) fail();
      if (parts[2] === 'massPerSquareMetre') {
        c!.massPerSquareMetre = value;
      } else if (parts[2] === 'limits') {
        const lim = c!.limits.find((l) => l.layerId === parts[3]);
        if (!lim) fail();
        const field = parts[4] as 'maxSpacing' | 'maxSpan';
        if (field !== 'maxSpacing' && field !== 'maxSpan') fail();
        lim![field] = value;
      } else fail();
      break;
    }
    case 'layers': {
      const l = next.layers.find((x) => x.id === parts[1]) as Record<string, unknown> | undefined;
      if (!l) fail();
      const field = parts[2]!;
      if (!(field in l!)) fail();
      l![field] = value;
      break;
    }
    case 'penetration': {
      if (!next.penetration) fail();
      const field = parts[1]! as keyof NonNullable<RulePack['penetration']>;
      if (!(field in next.penetration!)) fail();
      (next.penetration as unknown as Record<string, unknown>)[field] = value;
      break;
    }
    case 'buildUp': {
      const field = parts[1]! as keyof RulePack['buildUp'];
      if (!(field in next.buildUp)) fail();
      (next.buildUp as unknown as Record<string, unknown>)[field] = value;
      break;
    }
    case 'optimisation': {
      const field = parts[1]! as keyof RulePack['optimisation'];
      if (!(field in next.optimisation)) fail();
      (next.optimisation as unknown as Record<string, unknown>)[field] = value;
      break;
    }
    default:
      fail();
  }

  if (!valueSlots(next).some((s) => s.path === path)) fail();
  return next;
}

/** Record where a figure came from. Entering a value without one leaves the pack undefensible. */
export function setCitation(pack: RulePack, path: string, citation: Citation | null): RulePack {
  const next: RulePack = structuredClone(pack);
  if (citation === null) delete next.citations[path];
  else next.citations[path] = citation;
  return next;
}

/**
 * Publish an edited pack under a new version.
 *
 * Editing in place would silently change what an existing project regenerates to, so
 * the editor always forks: the old version stays exactly as it was, and a project has
 * to be moved to the new one deliberately.
 */
export function forkVersion(pack: RulePack, version: string, status: RulePack['status'] = 'user-entered'): RulePack {
  return { ...structuredClone(pack), version, status };
}

// --------------------------------------------------------------------------------
// Structural editing: layers and catalogue.
//
// A pack's shape is data too. Adding a rail, a second stage of suspension or a product
// nobody has catalogued yet has to be doable from the app, or "adding a system is a
// data task" only holds for whoever is willing to hand-edit JSON.
//
// Everything here keeps the pack's cross-references intact. A layer is named by up to
// six other places - what bears on it, what runs along it, what hangs from it, what it
// is cut at, the penetration rule's trimmer, and every load case's limits - and a
// structural edit that leaves one of those dangling produces a pack that loads with
// errors and generates nothing.
// --------------------------------------------------------------------------------

/** Somewhere a layer is named by something else in the pack. */
export interface LayerReference {
  readonly from: string;
  readonly field: string;
  readonly description: string;
}

/**
 * Layers that cannot survive without `layerId`, and so go with it.
 *
 * Detaching works for most references - a layer can bear on nothing, hang from the
 * structure, be cut at no crossings. It does not work for the layer a set of points
 * runs along: a clip on a channel that no longer exists is not a clip with a missing
 * field, it is not a clip. Those cascade, and this says which before anything happens.
 */
export function layersRemovedWith(pack: RulePack, layerId: string): string[] {
  const going = new Set([layerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of pack.layers) {
      if (going.has(l.id)) continue;
      if (l.generator === 'along-member' && going.has(l.along)) {
        going.add(l.id);
        changed = true;
      }
    }
  }
  going.delete(layerId);
  return [...going].sort();
}

/** Every place that names `layerId`, so a removal can say what it would break. */
export function layerReferences(pack: RulePack, layerId: string): LayerReference[] {
  const out: LayerReference[] = [];
  for (const l of pack.layers) {
    if (l.id === layerId) continue;
    const note = (field: string, description: string): void => {
      out.push({ from: `layers.${l.id}`, field, description });
    };
    if (l.generator === 'line-array') {
      if (l.supportedBy === layerId) note('supportedBy', `"${l.id}" bears on it`);
      if (l.splitAtCrossingsWith === layerId) note('splitAtCrossingsWith', `"${l.id}" is cut where it crosses`);
    }
    if (l.generator === 'along-member') {
      if (l.along === layerId) note('along', `"${l.id}" runs along it`);
      if (l.hangsFrom === layerId) note('hangsFrom', `"${l.id}" hangs from it`);
      if (l.atCrossingsWith === layerId) note('atCrossingsWith', `"${l.id}" is placed at crossings with it`);
    }
  }
  if (pack.penetration?.trimmerLayer === layerId) {
    out.push({ from: 'penetration', field: 'trimmerLayer', description: 'openings are trimmed with it' });
  }
  return out;
}

/** Products a layer uses, so removing one can say what it would leave without a product. */
export function productReferences(pack: RulePack, code: string): LayerReference[] {
  const out: LayerReference[] = [];
  for (const l of pack.layers) {
    if (l.product === code) out.push({ from: `layers.${l.id}`, field: 'product', description: `"${l.id}" is made from it` });
    if (l.alternativeProducts.includes(code)) {
      out.push({ from: `layers.${l.id}`, field: 'alternativeProducts', description: `"${l.id}" lists it as an alternative` });
    }
    if (l.fixings.productCode === code) {
      out.push({ from: `layers.${l.id}`, field: 'fixings.productCode', description: `"${l.id}" fixes with it` });
    }
  }
  return out;
}

export type Generator = Layer['generator'];

/**
 * A blank layer of the given kind.
 *
 * Every figure starts null, so a layer added here behaves exactly like one in a
 * shipped skeleton: the engine reports what it needs rather than generating on a
 * default nobody entered.
 */
export function blankLayer(
  generator: Generator,
  id: string,
  description: string,
  memberType: MemberType,
  wiring: { readonly along?: string; readonly orientation?: 'primary' | 'secondary' } = {},
): Layer {
  const common = { id, description, memberType, product: null, alternativeProducts: [], enabled: true, fixings: {}, heightAboveFcl: null };
  switch (generator) {
    case 'line-array':
      return layerSchema.parse({ ...common, generator, orientation: wiring.orientation ?? 'primary' });
    case 'along-member':
      // A layer of points has to know what it runs along. There is no sensible blank:
      // a clip that sits on nothing is not a clip, so the host is asked for up front
      // rather than left as an empty string the schema would reject anyway.
      if (!wiring.along) throw new Error(`an along-member layer needs the layer it runs along; none given for "${id}"`);
      return layerSchema.parse({ ...common, generator, along: wiring.along });
    case 'perimeter':
      return layerSchema.parse({ ...common, generator });
    case 'brace':
      return layerSchema.parse({ ...common, generator, enabled: false });
  }
}

/**
 * Add a layer, and give every load case a limits row for it so its spacing and span
 * can be entered per lining straight away.
 */
export function addLayer(pack: RulePack, layer: Layer, insertAfter?: string): RulePack {
  if (pack.layers.some((l) => l.id === layer.id)) {
    throw new Error(`layer "${layer.id}" is already in ${pack.system}@${pack.version}`);
  }
  const next: RulePack = structuredClone(pack);
  const at = insertAfter ? next.layers.findIndex((l) => l.id === insertAfter) : -1;
  const layers = [...next.layers];
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, structuredClone(layer));
  next.layers = layers;
  for (const c of next.loadCases) {
    if (!c.limits.some((l) => l.layerId === layer.id)) {
      c.limits.push({ layerId: layer.id, maxSpacing: null, maxSpan: null });
    }
  }
  return next;
}

/** Copy a layer under a new id, which is the quickest way to a second rail or rod stage. */
export function duplicateLayer(pack: RulePack, layerId: string, newId: string, description?: string): RulePack {
  const source = pack.layers.find((l) => l.id === layerId);
  if (!source) throw new Error(`no layer "${layerId}" in ${pack.system}@${pack.version}`);
  const copy = { ...structuredClone(source), id: newId, description: description ?? `${source.description} (copy)` } as Layer;
  const next = addLayer(pack, copy, layerId);
  // Carry the citations across too: the figures were copied, so their sources are the
  // same until someone changes them.
  const cloned: Record<string, Citation> = { ...next.citations };
  for (const [path, citation] of Object.entries(pack.citations)) {
    if (path.startsWith(`layers.${layerId}.`)) {
      cloned[`layers.${newId}.${path.slice(`layers.${layerId}.`.length)}`] = citation;
    }
  }
  return { ...next, citations: cloned };
}

export interface RemoveOptions {
  /** Null out anything that names the layer instead of refusing. */
  readonly detach?: boolean;
}

/**
 * Remove a layer.
 *
 * Refuses by default when something still names it: silently detaching a rail that
 * three other layers bear on turns a deliberate edit into a quiet change of what the
 * ceiling is. Pass `detach` once the caller has seen what it would break.
 */
export function removeLayer(pack: RulePack, layerId: string, options: RemoveOptions = {}): RulePack {
  if (!pack.layers.some((l) => l.id === layerId)) {
    throw new Error(`no layer "${layerId}" in ${pack.system}@${pack.version}`);
  }
  const refs = layerReferences(pack, layerId);
  if (refs.length > 0 && !options.detach) {
    throw new Error(
      `layer "${layerId}" cannot be removed while ${refs.length} thing(s) name it: ${refs.map((r) => r.description).join('; ')}`,
    );
  }

  const going = new Set([layerId, ...layersRemovedWith(pack, layerId)]);
  const next: RulePack = structuredClone(pack);
  next.layers = next.layers.filter((l) => !going.has(l.id));
  for (const l of next.layers) {
    const anyLayer = l as unknown as Record<string, unknown>;
    // `along` is not in this list: a layer of points cannot be detached from its host,
    // so it was removed with it above.
    for (const field of ['supportedBy', 'splitAtCrossingsWith', 'hangsFrom', 'atCrossingsWith']) {
      if (typeof anyLayer[field] === 'string' && going.has(anyLayer[field] as string)) anyLayer[field] = null;
    }
  }
  if (next.penetration && next.penetration.trimmerLayer !== null && going.has(next.penetration.trimmerLayer)) {
    next.penetration.trimmerLayer = null;
  }
  for (const c of next.loadCases) c.limits = c.limits.filter((l) => !going.has(l.layerId));
  for (const path of Object.keys(next.citations)) {
    for (const id of going) if (citationBelongsToLayer(path, id)) delete next.citations[path];
  }
  return next;
}

/**
 * Rename a layer, rewriting everything that names it.
 *
 * The id is not a label - it appears in every member's identity, so renaming one
 * orphans the manual edits made against it. The engine reports those rather than
 * dropping them, which is the honest outcome, but it is worth knowing before you do it.
 */
export function renameLayer(pack: RulePack, from: string, to: string): RulePack {
  if (from === to) return pack;
  if (!pack.layers.some((l) => l.id === from)) throw new Error(`no layer "${from}"`);
  if (pack.layers.some((l) => l.id === to)) throw new Error(`layer "${to}" already exists`);

  const next: RulePack = structuredClone(pack);
  for (const l of next.layers) {
    if (l.id === from) l.id = to;
    const anyLayer = l as unknown as Record<string, unknown>;
    for (const field of ['supportedBy', 'splitAtCrossingsWith', 'along', 'hangsFrom', 'atCrossingsWith']) {
      if (anyLayer[field] === from) anyLayer[field] = to;
    }
  }
  if (next.penetration?.trimmerLayer === from) next.penetration.trimmerLayer = to;
  for (const c of next.loadCases) for (const l of c.limits) if (l.layerId === from) l.layerId = to;
  next.citations = renameCitationKeys(next.citations, from, to);
  return next;
}

/**
 * A layer's id appears in two shapes of citation key: its own figures, and its limits
 * under each load case. Rewriting only the first leaves the load case sources behind,
 * and the pack starts reporting figures as uncited that were cited a moment ago.
 */
function renameCitationKeys(citations: Record<string, Citation>, from: string, to: string): Record<string, Citation> {
  const out: Record<string, Citation> = {};
  for (const [path, citation] of Object.entries(citations)) {
    out[citationPathFor(path, from, to)] = citation;
  }
  return out;
}

function citationPathFor(path: string, from: string, to: string): string {
  if (path.startsWith(`layers.${from}.`)) return `layers.${to}.${path.slice(`layers.${from}.`.length)}`;
  const limits = path.match(/^(loadCases\.[^.]+\.limits\.)([^.]+)(\..+)$/);
  if (limits && limits[2] === from) return `${limits[1]}${to}${limits[3]}`;
  return path;
}

/** True when a citation key belongs to a layer, in either of the two shapes. */
function citationBelongsToLayer(path: string, layerId: string): boolean {
  if (path.startsWith(`layers.${layerId}.`)) return true;
  const limits = path.match(/^loadCases\.[^.]+\.limits\.([^.]+)\..+$/);
  return limits?.[1] === layerId;
}

/** Change anything on a layer that is not a figure - its product, its wiring, its name. */
export function updateLayer(pack: RulePack, layerId: string, patch: Record<string, unknown>): RulePack {
  const next: RulePack = structuredClone(pack);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`no layer "${layerId}" in ${pack.system}@${pack.version}`);
  if ('id' in patch) throw new Error('use renameLayer to change a layer id, so its references follow it');
  if ('generator' in patch) throw new Error('a layer cannot change what generates it; add a new layer instead');
  Object.assign(layer, patch);
  // Re-parse so a bad value is refused here rather than at generation.
  next.layers = next.layers.map((l) => (l.id === layerId ? layerSchema.parse(l) : l));
  return next;
}

export function moveLayer(pack: RulePack, layerId: string, delta: number): RulePack {
  const next: RulePack = structuredClone(pack);
  const i = next.layers.findIndex((l) => l.id === layerId);
  if (i < 0) throw new Error(`no layer "${layerId}"`);
  const j = Math.max(0, Math.min(next.layers.length - 1, i + delta));
  const [moved] = next.layers.splice(i, 1);
  next.layers.splice(j, 0, moved!);
  return next;
}

/** A blank catalogue entry, for a product nobody has catalogued yet. */
export function blankProduct(code: string, description: string, roles: MemberType[]): Product {
  return productSchema.parse({ code, description, roles });
}

export function addProduct(pack: RulePack, product: Product): RulePack {
  if (pack.catalogue.some((p) => p.code === product.code)) {
    throw new Error(`product "${product.code}" is already in ${pack.system}@${pack.version}`);
  }
  return { ...structuredClone(pack), catalogue: [...structuredClone(pack.catalogue), structuredClone(product)] };
}

export function updateProduct(pack: RulePack, code: string, patch: Record<string, unknown>): RulePack {
  const next: RulePack = structuredClone(pack);
  const product = next.catalogue.find((p) => p.code === code);
  if (!product) throw new Error(`no product "${code}" in ${pack.system}@${pack.version}`);
  if ('code' in patch) throw new Error('renaming a product code would orphan the layers using it');
  Object.assign(product, patch);
  next.catalogue = next.catalogue.map((p) => (p.code === code ? productSchema.parse(p) : p));
  return next;
}

export function removeProduct(pack: RulePack, code: string, options: RemoveOptions = {}): RulePack {
  const refs = productReferences(pack, code);
  if (refs.length > 0 && !options.detach) {
    throw new Error(
      `product "${code}" cannot be removed while ${refs.length} layer reference(s) use it: ${refs.map((r) => r.description).join('; ')}`,
    );
  }
  const next: RulePack = structuredClone(pack);
  next.catalogue = next.catalogue.filter((p) => p.code !== code);
  for (const l of next.layers) {
    if (l.product === code) l.product = null;
    l.alternativeProducts = l.alternativeProducts.filter((a) => a !== code);
    if (l.fixings.productCode === code) l.fixings.productCode = null;
  }
  for (const path of Object.keys(next.citations)) {
    if (path.startsWith(`catalogue.${code}.`)) delete next.citations[path];
  }
  return next;
}

/** Add a load case, with a blank limits row for every layer already in the pack. */
export function addLoadCase(pack: RulePack, id: string, description: string): RulePack {
  if (pack.loadCases.some((c) => c.id === id)) throw new Error(`load case "${id}" already exists`);
  const next: RulePack = structuredClone(pack);
  next.loadCases.push({
    id,
    description,
    lining: null,
    massPerSquareMetre: null,
    limits: next.layers.map((l) => ({ layerId: l.id, maxSpacing: null, maxSpan: null })),
  });
  return next;
}

export function removeLoadCase(pack: RulePack, id: string): RulePack {
  const next: RulePack = structuredClone(pack);
  next.loadCases = next.loadCases.filter((c) => c.id !== id);
  for (const path of Object.keys(next.citations)) {
    if (path.startsWith(`loadCases.${id}.`)) delete next.citations[path];
  }
  return next;
}
