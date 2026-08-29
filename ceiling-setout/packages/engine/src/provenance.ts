import type { RulePack } from '@ceiling/rules';
import type { SpacingResolution } from '@ceiling/rules';
import type { Provenance } from './types.js';

export function packKeyOf(pack: RulePack): string {
  return `${pack.system}@${pack.version}`;
}

export interface ProvenanceInput {
  readonly pack: RulePack;
  readonly ruleId: string;
  readonly reason: string;
  readonly spacingUsed?: number | null;
  readonly spanUsed?: number | null;
  readonly constraints?: readonly { path: string; value: number }[];
}

export function provenance(input: ProvenanceInput): Provenance {
  const citation = input.pack.citations[input.ruleId];
  return {
    ruleId: input.ruleId,
    rulePackVersion: packKeyOf(input.pack),
    reason: input.reason,
    spacingUsed: input.spacingUsed ?? null,
    spanUsed: input.spanUsed ?? null,
    constraints: input.constraints ?? [],
    citation: citation ? `${citation.source}${citation.reference ? ` (${citation.reference})` : ''}` : null,
  };
}

/** Provenance for a member placed by a spacing rule, carrying everything that was weighed. */
export function spacingProvenance(
  pack: RulePack,
  resolution: SpacingResolution,
  reason: string,
  spanUsed: number | null = null,
): Provenance {
  return provenance({
    pack,
    ruleId: resolution.governedBy ?? `layers.${resolution.layerId}`,
    reason,
    spacingUsed: resolution.spacing,
    spanUsed,
    constraints: resolution.candidates.map((c) => ({ path: c.path, value: c.value })),
  });
}
