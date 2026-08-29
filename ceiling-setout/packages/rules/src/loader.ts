import { z } from 'zod';
import { rulePackSchema, type Layer, type RulePack } from './schema.js';
import { readiness } from './paths.js';
import { isAlongMember, isBrace, isLineArray, isPerimeter } from './values.js';

export interface PackProblem {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface LoadResult {
  readonly pack: RulePack | null;
  readonly problems: readonly PackProblem[];
}

/** `system@version`. Projects store this so an old project regenerates identically. */
export const packKey = (pack: Pick<RulePack, 'system' | 'version'>): string => `${pack.system}@${pack.version}`;

/**
 * Parse and check a rule pack.
 *
 * Shape errors come from the schema. The cross-references below are the ones the
 * schema cannot see: a layer that bears on a layer that does not exist, or a product
 * code with nothing behind it in the catalogue, would otherwise surface much later as
 * an empty drawing rather than a plain message about the pack.
 */
export function loadRulePack(input: unknown): LoadResult {
  const parsed = rulePackSchema.safeParse(input);
  if (!parsed.success) {
    return { pack: null, problems: parsed.error.issues.map(toProblem) };
  }
  const pack = parsed.data;
  const problems: PackProblem[] = [...crossCheck(pack)];

  const r = readiness(pack);
  if (pack.status === 'verified' && !r.generatable) {
    problems.push({
      severity: 'error',
      code: 'VERIFIED_BUT_INCOMPLETE',
      path: 'status',
      message: `pack is marked verified but ${r.missingRequired.length} required value(s) are still blank`,
    });
  }
  if (pack.status !== 'skeleton' && r.uncited.length > 0) {
    problems.push({
      severity: 'warning',
      code: 'UNCITED_VALUES',
      path: 'citations',
      message: `${r.uncited.length} entered value(s) have no citation: ${r.uncited.slice(0, 5).join(', ')}${r.uncited.length > 5 ? ', ...' : ''}`,
    });
  }
  return { pack, problems };
}

function toProblem(issue: z.ZodIssue): PackProblem {
  return {
    severity: 'error',
    code: `SCHEMA_${issue.code.toUpperCase()}`,
    path: issue.path.join('.'),
    message: issue.message,
  };
}

function crossCheck(pack: RulePack): PackProblem[] {
  const problems: PackProblem[] = [];
  const layerIds = new Set<string>();
  const productCodes = new Set(pack.catalogue.map((p) => p.code));

  for (const p of pack.catalogue) {
    if (productCodes.has(p.code) && pack.catalogue.filter((q) => q.code === p.code).length > 1) {
      problems.push({ severity: 'error', code: 'DUPLICATE_PRODUCT', path: `catalogue.${p.code}`, message: `product code "${p.code}" appears more than once` });
    }
  }

  for (const l of pack.layers) {
    if (layerIds.has(l.id)) {
      problems.push({ severity: 'error', code: 'DUPLICATE_LAYER', path: `layers.${l.id}`, message: `layer id "${l.id}" appears more than once` });
    }
    layerIds.add(l.id);
  }

  const layerExists = (id: string | null): boolean => id === null || layerIds.has(id);
  const ref = (id: string | null, path: string, what: string): void => {
    if (!layerExists(id)) {
      problems.push({ severity: 'error', code: 'UNKNOWN_LAYER_REF', path, message: `${what} refers to layer "${id}", which is not in this pack` });
    }
  };

  for (const l of pack.layers) {
    const base = `layers.${l.id}`;
    if (l.product !== null && !productCodes.has(l.product)) {
      problems.push({ severity: 'error', code: 'UNKNOWN_PRODUCT_REF', path: `${base}.product`, message: `layer "${l.id}" uses product "${l.product}", which is not in the catalogue` });
    }
    for (const alt of l.alternativeProducts) {
      if (!productCodes.has(alt)) {
        problems.push({ severity: 'warning', code: 'UNKNOWN_PRODUCT_REF', path: `${base}.alternativeProducts`, message: `alternative product "${alt}" is not in the catalogue` });
      }
    }
    const product = pack.catalogue.find((p) => p.code === l.product);
    if (product && !product.roles.includes(l.memberType)) {
      problems.push({ severity: 'warning', code: 'PRODUCT_ROLE_MISMATCH', path: `${base}.product`, message: `layer "${l.id}" is a ${l.memberType} but product "${l.product}" is catalogued for ${product.roles.join(', ')}` });
    }
    if (isLineArray(l)) {
      ref(l.supportedBy, `${base}.supportedBy`, `layer "${l.id}"`);
      ref(l.splitAtCrossingsWith, `${base}.splitAtCrossingsWith`, `layer "${l.id}"`);
      if (l.supportedBy === l.id) {
        problems.push({ severity: 'error', code: 'SELF_SUPPORT', path: `${base}.supportedBy`, message: `layer "${l.id}" cannot bear on itself` });
      }
    }
    if (isAlongMember(l)) {
      ref(l.along, `${base}.along`, `layer "${l.id}"`);
      ref(l.atCrossingsWith, `${base}.atCrossingsWith`, `layer "${l.id}"`);
      const host = pack.layers.find((h) => h.id === l.along);
      if (host && !isLineArray(host) && !isPerimeter(host)) {
        problems.push({ severity: 'error', code: 'INVALID_HOST_LAYER', path: `${base}.along`, message: `layer "${l.id}" runs along "${l.along}", which generates no members to run along` });
      }
    }
    if (isBrace(l) && l.memberType !== 'brace') {
      problems.push({ severity: 'warning', code: 'BRACE_TYPE_MISMATCH', path: `${base}.memberType`, message: `bracing layer "${l.id}" is typed as ${l.memberType}` });
    }
  }

  for (const c of pack.loadCases) {
    for (const lim of c.limits) {
      ref(lim.layerId, `loadCases.${c.id}.limits.${lim.layerId}`, `load case "${c.id}"`);
    }
  }

  if (pack.penetration) {
    ref(pack.penetration.trimmerLayer, 'penetration.trimmerLayer', 'penetration rule');
  }

  const cycle = findSupportCycle(pack.layers);
  if (cycle) {
    problems.push({ severity: 'error', code: 'SUPPORT_CYCLE', path: 'layers', message: `layers bear on each other in a cycle: ${cycle.join(' -> ')}` });
  }

  for (const key of Object.keys(pack.citations)) {
    if (!key.includes('.')) {
      problems.push({ severity: 'warning', code: 'BAD_CITATION_KEY', path: `citations.${key}`, message: `citation key "${key}" is not a value path` });
    }
  }

  return problems;
}

/** A support cycle would make spacing resolution non-terminating, so it is rejected outright. */
function findSupportCycle(layers: readonly Layer[]): string[] | null {
  const next = new Map<string, string>();
  for (const l of layers) if (isLineArray(l) && l.supportedBy) next.set(l.id, l.supportedBy);
  for (const start of next.keys()) {
    const seen: string[] = [];
    let cur: string | undefined = start;
    while (cur && next.has(cur)) {
      if (seen.includes(cur)) return [...seen.slice(seen.indexOf(cur)), cur];
      seen.push(cur);
      cur = next.get(cur);
    }
  }
  return null;
}

export const hasErrors = (problems: readonly PackProblem[]): boolean => problems.some((p) => p.severity === 'error');

/** Parse and throw on error. For fixtures and tests, where a bad pack is a bug. */
export function loadRulePackOrThrow(input: unknown): RulePack {
  const { pack, problems } = loadRulePack(input);
  if (!pack || hasErrors(problems)) {
    const errors = problems.filter((p) => p.severity === 'error').map((p) => `${p.path}: ${p.message}`);
    throw new Error(`invalid rule pack:\n  ${errors.join('\n  ')}`);
  }
  return pack;
}
