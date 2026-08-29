import rondoKeylock from '../packs/rondo_keylock.2026.1.json';
import rondoKeylockExample from '../packs/rondo_keylock.2026.1-example.json';
import tbarGrid from '../packs/tbar_grid.2026.1.json';
import tbarGridExample from '../packs/tbar_grid.2026.1-example.json';
import rondoDirectFix from '../packs/rondo_furring_directfix.2026.1.json';
import nvelopeRail from '../packs/nvelope_rail.2026.1.json';
import sculptformBatten from '../packs/sculptform_batten.2026.1.json';
import { loadRulePackOrThrow } from './loader.js';
import { RulePackRegistry } from './registry.js';
import type { RulePack } from './schema.js';

/** Packs shipped with the app, as raw JSON. */
export const builtinPackJson: readonly unknown[] = [
  rondoKeylock,
  rondoKeylockExample,
  tbarGrid,
  tbarGridExample,
  rondoDirectFix,
  nvelopeRail,
  sculptformBatten,
];

/**
 * The shipped packs, parsed.
 *
 * Five skeletons with every figure blank, and two example packs whose figures are
 * invented. Nothing here carries a real manufacturer value: the skeletons are what a
 * user fills in, and the examples exist so the tests and the demo have something to
 * generate, clearly marked so their output can never be mistaken for the real thing.
 */
export function builtinPacks(): RulePack[] {
  return builtinPackJson.map(loadRulePackOrThrow);
}

export function builtinRegistry(): RulePackRegistry {
  const registry = new RulePackRegistry();
  for (const pack of builtinPacks()) registry.register(pack);
  return registry;
}

/** True when the pack's figures are invented, so output from it must say so. */
export const isExamplePack = (pack: RulePack): boolean => pack.status === 'example';

/** The banner every drawing, schedule and report carries when a pack is not verified. */
export function provenanceBanner(pack: RulePack): string {
  const base = `Generated against rule pack ${pack.system}@${pack.version}.`;
  switch (pack.status) {
    case 'example':
      return `${base} THE VALUES IN THIS PACK ARE INVENTED EXAMPLE DATA AND MUST NOT BE BUILT FROM. Structural verification remains with the engineer.`;
    case 'skeleton':
      return `${base} This pack has no values entered. Structural verification remains with the engineer.`;
    case 'user-entered':
      return `${base} Values entered by the user from ${pack.source.source}; not independently checked. Within the rule pack values entered - structural verification remains with the engineer.`;
    case 'verified':
      return `${base} Values checked against ${pack.source.source}${pack.source.revision ? ` rev ${pack.source.revision}` : ''}. Within the rule pack values entered - structural verification remains with the engineer.`;
  }
}
