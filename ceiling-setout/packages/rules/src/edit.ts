import type { Citation, RulePack } from './schema.js';
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
