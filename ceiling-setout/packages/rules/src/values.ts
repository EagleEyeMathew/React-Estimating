import type {
  AlongMemberLayer,
  BraceLayer,
  Citation,
  Layer,
  LineArrayLayer,
  LoadCase,
  PerimeterLayer,
  Product,
  RulePack,
} from './schema.js';

/** A figure the pack does not yet carry, named by the path the editor uses. */
export interface MissingValue {
  readonly path: string;
  readonly description: string;
}

/** A figure that was found, with where it came from. */
export interface ResolvedValue {
  readonly path: string;
  readonly value: number;
  readonly citation: Citation | null;
}

export const isLineArray = (l: Layer): l is LineArrayLayer => l.generator === 'line-array';
export const isAlongMember = (l: Layer): l is AlongMemberLayer => l.generator === 'along-member';
export const isPerimeter = (l: Layer): l is PerimeterLayer => l.generator === 'perimeter';
export const isBrace = (l: Layer): l is BraceLayer => l.generator === 'brace';

/**
 * Read-only view of a pack under one load case.
 *
 * Every read either yields a value with its citation, or records a missing value. The
 * engine never sees a substituted default, so a pack with a blank span figure
 * produces an issue naming that figure rather than a drawing built on a guess.
 */
export class PackReader {
  readonly pack: RulePack;
  readonly loadCase: LoadCase | null;
  private readonly missingByPath = new Map<string, MissingValue>();

  constructor(pack: RulePack, loadCaseId?: string | null) {
    this.pack = pack;
    this.loadCase = loadCaseId ? (pack.loadCases.find((c) => c.id === loadCaseId) ?? null) : null;
    if (loadCaseId && !this.loadCase) {
      this.note(`loadCases.${loadCaseId}`, `load case "${loadCaseId}" is not in rule pack ${pack.system}@${pack.version}`);
    }
  }

  get missing(): MissingValue[] {
    return [...this.missingByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  note(path: string, description: string): void {
    if (!this.missingByPath.has(path)) this.missingByPath.set(path, { path, description });
  }

  citation(path: string): Citation | null {
    return this.pack.citations[path] ?? null;
  }

  /** A required figure. Returns null and records the gap when it has not been entered. */
  require(path: string, value: number | null | undefined, description: string): ResolvedValue | null {
    if (value === null || value === undefined) {
      this.note(path, description);
      return null;
    }
    return { path, value, citation: this.citation(path) };
  }

  /** An optional figure. Absence is not a gap. */
  optional(path: string, value: number | null | undefined): ResolvedValue | null {
    return value === null || value === undefined ? null : { path, value, citation: this.citation(path) };
  }

  layer(id: string): Layer | null {
    return this.pack.layers.find((l) => l.id === id) ?? null;
  }

  layers(): Layer[] {
    return this.pack.layers.filter((l) => l.enabled);
  }

  product(code: string | null): Product | null {
    return code ? (this.pack.catalogue.find((p) => p.code === code) ?? null) : null;
  }

  /** The load case limit for a layer, if the selected load case declares one. */
  limitFor(layerId: string): { maxSpacing: ResolvedValue | null; maxSpan: ResolvedValue | null } {
    if (!this.loadCase) return { maxSpacing: null, maxSpan: null };
    const limit = this.loadCase.limits.find((l) => l.layerId === layerId);
    if (!limit) return { maxSpacing: null, maxSpan: null };
    const base = `loadCases.${this.loadCase.id}.limits.${layerId}`;
    return {
      maxSpacing: this.optional(`${base}.maxSpacing`, limit.maxSpacing),
      maxSpan: this.optional(`${base}.maxSpan`, limit.maxSpan),
    };
  }
}

/** The constraint that decided a spacing, and everything it was chosen against. */
export interface SpacingResolution {
  readonly layerId: string;
  readonly spacing: number | null;
  /** Path of the binding constraint - the value that actually set the spacing. */
  readonly governedBy: string | null;
  readonly candidates: readonly ResolvedValue[];
  /** Set when the layer has a fixed visible module rather than a free spacing. */
  readonly module: number | null;
  /** True when the fixed module exceeds a limit, so it cannot simply be reduced. */
  readonly moduleExceedsLimit: boolean;
  readonly citation: Citation | null;
}

/**
 * The spacing to build a layer at.
 *
 * Three things can constrain it and the tightest wins: the layer's own maximum, the
 * load case's limit for the layer, and - for a layer that carries another - the
 * allowable span of the layer it carries. That last one is why a TSR array tightens
 * when the furring below it is asked to hold a heavier lining.
 *
 * A layer with a fixed module is different in kind: the module is the visible
 * setting-out module and cannot be quietly reduced to satisfy a span, so it is
 * returned as-is with a flag when it breaches a limit, for the validator to report.
 */
export function resolveSpacing(reader: PackReader, layerId: string): SpacingResolution {
  const layer = reader.layer(layerId);
  if (!layer || (!isLineArray(layer) && !isAlongMember(layer))) {
    return { layerId, spacing: null, governedBy: null, candidates: [], module: null, moduleExceedsLimit: false, citation: null };
  }

  const candidates: ResolvedValue[] = [];
  const own = reader.optional(`layers.${layerId}.maxSpacing`, layer.maxSpacing);
  if (own) candidates.push(own);

  const limit = reader.limitFor(layerId);
  if (limit.maxSpacing) candidates.push(limit.maxSpacing);

  // Layers that bear on this one cap its spacing by their own allowable span.
  if (isLineArray(layer)) {
    for (const carried of reader.pack.layers) {
      if (!isLineArray(carried) || carried.supportedBy !== layerId || !carried.enabled) continue;
      const carriedLimit = reader.limitFor(carried.id);
      if (carriedLimit.maxSpan) candidates.push(carriedLimit.maxSpan);
    }
  }

  const module = isLineArray(layer) ? layer.module : null;
  if (module !== null) {
    const breached = candidates.some((c) => module > c.value + 1e-9);
    return {
      layerId,
      spacing: module,
      governedBy: `layers.${layerId}.module`,
      candidates,
      module,
      moduleExceedsLimit: breached,
      citation: reader.citation(`layers.${layerId}.module`),
    };
  }

  if (candidates.length === 0) {
    reader.note(
      `layers.${layerId}.maxSpacing`,
      `no maximum spacing for layer "${layerId}" - enter it on the layer or in the load case`,
    );
    return { layerId, spacing: null, governedBy: null, candidates, module: null, moduleExceedsLimit: false, citation: null };
  }

  // Ties resolve to the first candidate in a fixed order, so the result is stable.
  let binding = candidates[0]!;
  for (const c of candidates) if (c.value < binding.value - 1e-9) binding = c;
  return {
    layerId,
    spacing: binding.value,
    governedBy: binding.path,
    candidates,
    module: null,
    moduleExceedsLimit: false,
    citation: binding.citation,
  };
}

/** Allowable unsupported span of a layer under the selected load case. */
export function resolveSpan(reader: PackReader, layerId: string): ResolvedValue | null {
  return reader.limitFor(layerId).maxSpan;
}
