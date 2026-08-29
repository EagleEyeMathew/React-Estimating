import { normalise, perp, quantise, type Vec2 } from '@ceiling/geometry';
import {
  PackReader,
  RulePackRegistry,
  isAlongMember,
  isBrace,
  isLineArray,
  isPerimeter,
  provenanceBanner,
  resolveSpacing,
  type Layer,
  type LineArrayLayer,
  type RulePack,
} from '@ceiling/rules';
import type { Project, Zone } from './project.js';
import { IssueLog } from './issues.js';
import { applyOverrides } from './overrides.js';
import { packKeyOf } from './provenance.js';
import { generateLineArray, splitAtCrossings } from './steps/arrays.js';
import { generateAlongMember } from './steps/hangers.js';
import { generateBracing } from './steps/bracing.js';
import { generatePerimeter } from './steps/perimeter.js';
import {
  classifyPenetrations,
  clearanceConflicts,
  cutOpenings,
  generateTrimmers,
} from './steps/penetrations.js';
import { resolveZone } from './steps/resolveZone.js';
import { resolveDirection, resolveOrigin } from './steps/setout.js';
import { planLattice } from './steps/lattice.js';
import { validate } from './steps/validate.js';
import { nestCuts, type Nesting } from './steps/optimise.js';
import type { GenerationResult, Member, SetoutDecision, ZoneResult } from './types.js';

export interface GenerateOptions {
  readonly project: Project;
  readonly registry: RulePackRegistry;
}

/**
 * Run the pipeline over a project.
 *
 * The output has no timestamps and no generated ordering: the same project with the
 * same pack versions produces byte-identical JSON every time, which is what lets a
 * user tell a real change from noise when they regenerate after editing one figure.
 */
export function generate(options: GenerateOptions): GenerationResult & { readonly nesting: Record<string, Nesting> } {
  const { project, registry } = options;
  const issues = new IssueLog();
  const zones: ZoneResult[] = [];
  const packKeys = new Set<string>();
  const banners = new Set<string>();

  for (const zone of project.zones) {
    const result = generateZone(project, zone, registry, issues);
    if (result) {
      zones.push(result);
      packKeys.add(result.packKey);
      const pack = registry.getByKey(result.packKey);
      if (pack) banners.add(provenanceBanner(pack));
    }
  }

  const generated = zones.flatMap((z) => z.members);
  const { members, orphaned } = applyOverrides(generated, project.overrides);
  for (const id of orphaned) {
    issues.warn(
      'OVERRIDE_ORPHANED',
      `a manual edit refers to member "${id}", which this setout no longer contains - the edit has not been applied`,
      { memberIds: [id] },
    );
  }

  const nesting: Record<string, Nesting> = {};
  for (const key of packKeys) {
    const pack = registry.getByKey(key);
    if (!pack) continue;
    const forPack = members.filter((m) => zones.some((z) => z.packKey === key && z.zoneId === m.zoneId));
    nesting[key] = nestCuts(forPack, pack);
  }

  return {
    projectId: project.id,
    projectName: project.name,
    zones: zones.map((z) => ({ ...z, members: members.filter((m) => m.zoneId === z.zoneId) })),
    members: [...members].sort((a, b) => a.id.localeCompare(b.id)),
    issues: issues.all(),
    banners: [...banners].sort(),
    packKeys: [...packKeys].sort(),
    orphanedOverrides: orphaned,
    nesting,
  };
}

/**
 * Order along-member layers so nothing is generated before what it hangs from.
 * A cycle is already rejected by the loader, so a layer that cannot be placed here is
 * one whose host is switched off - it is emitted last and reports itself.
 */
function orderAlongMembers<T extends { id: string; hangsFrom: string | null }>(layers: readonly T[]): T[] {
  const done = new Set<string>();
  const out: T[] = [];
  let remaining = [...layers];
  while (remaining.length > 0) {
    const ready = remaining.filter((l) => l.hangsFrom === null || done.has(l.hangsFrom) || !layers.some((x) => x.id === l.hangsFrom));
    if (ready.length === 0) {
      out.push(...remaining);
      break;
    }
    for (const l of ready) {
      out.push(l);
      done.add(l.id);
    }
    remaining = remaining.filter((l) => !ready.includes(l));
  }
  return out;
}

function generateZone(
  project: Project,
  zone: Zone,
  registry: RulePackRegistry,
  issues: IssueLog,
): ZoneResult | null {
  // 1. Resolve the zone into geometry.
  const resolved = resolveZone(project, zone, issues);
  if (!resolved) return null;

  const pack = registry.get(zone.system.pack, zone.system.version);
  if (!pack) {
    issues.error(
      'PACK_MISSING',
      `${zone.name}: rule pack ${zone.system.pack}@${zone.system.version} is not loaded, so nothing was generated`,
      { zoneId: zone.id },
    );
    return null;
  }
  const packKey = packKeyOf(pack);
  const reader = new PackReader(pack, zone.system.loadCase);
  const { region, plane, structurePlane } = resolved;

  // 2 and 3. Setout direction and datum.
  const dir = resolveDirection(zone.setout.direction, resolved.boundaryRing, region);
  const org = resolveOrigin(zone.setout.origin, region, resolved.boundaryRing);

  // 8a. Openings large enough to cut the framing are removed before anything is generated.
  const split = classifyPenetrations(zone, pack.penetration, issues);
  const clearance = pack.penetration?.clearance ?? 0;
  const buildableRegion = cutOpenings(region, split.trimmed, clearance);

  const active = pack.layers.filter((l) => l.enabled && !zone.disabledLayers.includes(l.id));
  const membersByLayer = new Map<string, Member[]>();
  const layerOrigins: Record<string, Vec2> = {};
  const spacings: Record<string, { spacing: number | null; governedBy: string | null }> = {};
  const productOf = (l: Layer) => reader.product(l.product);

  // 4 and 5. Primary members, then the secondary members that carry them.
  const lineLayers = active.filter(isLineArray);
  const ordered = [
    ...lineLayers.filter((l) => l.orientation === 'primary'),
    ...lineLayers.filter((l) => l.orientation === 'secondary'),
  ];

  for (const layer of ordered) {
    const resolution = resolveSpacing(reader, layer.id);
    if (resolution.spacing === null) {
      spacings[layer.id] = { spacing: null, governedBy: resolution.governedBy };
      issues.error('SPACING_UNRESOLVED', `${layer.id}: spacing could not be resolved, so no members were generated`, {
        zoneId: zone.id,
        ruleId: `layers.${layer.id}.maxSpacing`,
      });
      continue;
    }
    const direction = layer.orientation === 'primary' ? dir.direction : perp(normalise(dir.direction));
    const plan = planLattice({
      region: buildableRegion,
      direction,
      maxSpacing: resolution.spacing,
      module: layer.module,
      maxFromWall: layer.maxFromWall,
      originSpec: zone.setout.origin,
      datum: org.origin,
      // Only the primary layer is moved to keep openings clear: it is the one a
      // downlight has to miss, and moving the layer above it as well would gain
      // nothing and lose the relationship between the two.
      penetrations:
        layer.orientation === 'primary' && zone.setout.avoidPenetrations ? split.untrimmed : [],
      minClearOfMember: pack.penetration?.minClearOfMember ?? 0,
    });
    // Rounded for reporting; the lattice itself runs on the exact value.
    spacings[layer.id] = { spacing: quantise(plan.spacing), governedBy: resolution.governedBy };
    layerOrigins[layer.id] = plan.origin;

    if (plan.nudged > 0) {
      issues.info(
        'SETOUT_NUDGED',
        `${layer.id}: the first member was set ${Math.round(plan.firstFromWall ?? 0)}mm off the wall rather than ${layer.maxFromWall}mm, to keep openings clear of the members`,
        { zoneId: zone.id, ruleId: 'penetration.minClearOfMember' },
      );
    }
    if (plan.extraBays > 0) {
      issues.info(
        'EXTRA_BAYS_ADDED',
        `${layer.id}: ${plan.extraBays} bay(s) beyond the minimum were added, tightening the spacing to ${quantise(plan.spacing)}mm, because no setout at the minimum kept every opening clear of a member. This is extra material - check it against the alternative of moving the services.`,
        { zoneId: zone.id, ruleId: 'penetration.minClearOfMember' },
      );
    }

    const outcome = generateLineArray({
      pack,
      layer,
      product: productOf(layer),
      resolution,
      plan,
      region: buildableRegion,
      direction,
      origin: plan.origin,
      plane,
      zoneId: zone.id,
      issues,
    });
    membersByLayer.set(layer.id, [...outcome.members]);
  }

  // Cut modular members at their crossings, once every layer exists.
  for (const layer of ordered) {
    if (layer.splitAtCrossingsWith === null) continue;
    const own = membersByLayer.get(layer.id);
    const cutters = membersByLayer.get(layer.splitAtCrossingsWith);
    if (own && cutters) membersByLayer.set(layer.id, splitAtCrossings(own, cutters, plane));
  }

  // 8b. Trimmers around the openings that were cut out.
  const trimmerLayerId = pack.penetration?.trimmerLayer ?? null;
  if (pack.penetration && trimmerLayerId && split.trimmed.length > 0) {
    const trimLayer = active.find((l) => l.id === trimmerLayerId);
    if (trimLayer && isLineArray(trimLayer)) {
      const primary = ordered.find((l) => l.orientation === 'primary');
      const primaryMembers = primary ? (membersByLayer.get(primary.id) ?? []) : [];
      const trimmers = generateTrimmers(
        {
          pack,
          rule: pack.penetration,
          layer: trimLayer,
          product: productOf(trimLayer),
          primaryMembers,
          plane,
          zone,
          direction: dir.direction,
          issues,
        },
        split.trimmed,
      );
      membersByLayer.set(trimLayer.id, [...(membersByLayer.get(trimLayer.id) ?? []), ...trimmers]);
    } else {
      issues.warn(
        'TRIMMER_LAYER_UNAVAILABLE',
        `openings need trimming but the trimmer layer "${trimmerLayerId}" is not active in this zone`,
        { zoneId: zone.id, ruleId: 'penetration.trimmerLayer' },
      );
    }
  }

  // 6 and 7. Hangers, clips and brackets, snapped to structure, with drops computed.
  // Ordered so a layer's host exists before it does: a rod hanging a strut has to be
  // generated after the strut, and a second-stage rod after the first.
  for (const layer of orderAlongMembers(active.filter(isAlongMember))) {
    const hosts = membersByLayer.get(layer.along) ?? [];
    if (hosts.length === 0) {
      issues.warn('NO_HOST_MEMBERS', `${layer.id}: no ${layer.along} members to place along`, { zoneId: zone.id });
      continue;
    }
    // Both ends of a hanger come from the layers it joins: the underside of whatever
    // carries it, and the top of whatever it hangs.
    const from = layer.hangsFrom ? active.find((l) => l.id === layer.hangsFrom) : null;
    const hostLayer = active.find((l) => l.id === layer.along);
    const hostProduct = hostLayer ? reader.product(hostLayer.product) : null;
    const hostTop =
      hostLayer?.heightAboveFcl !== null && hostLayer?.heightAboveFcl !== undefined
        ? hostLayer.heightAboveFcl + (hostProduct?.depth ?? 0)
        : null;

    const outcome = generateAlongMember({
      pack,
      layer,
      product: productOf(layer),
      hosts,
      crossing: layer.atCrossingsWith ? (membersByLayer.get(layer.atCrossingsWith) ?? []) : [],
      plane,
      structure: resolved.structure,
      structurePlane,
      zone,
      systemDepth: pack.buildUp.systemDepth,
      hangsFromLevel: from?.heightAboveFcl ?? null,
      hostTop,
      issues,
    });
    membersByLayer.set(layer.id, [...outcome.members]);
    if (outcome.bridging.length > 0) {
      membersByLayer.set('bridging', [...(membersByLayer.get('bridging') ?? []), ...outcome.bridging]);
      issues.info(
        'BRIDGING_ADDED',
        `${outcome.bridging.length} bridging member(s) were added where hangers had no structure to fix to; size and fixing are for the engineer`,
        { zoneId: zone.id },
      );
    }
  }

  // 9. Perimeter trim. Against the zone and its structural voids, not the buildable
  // region: wall angle follows walls, columns and stair voids. A service opening gets
  // a trimmed frame instead, which step 8 has already generated - running wall angle
  // round a diffuser would schedule trim nobody installs.
  for (const layer of active.filter(isPerimeter)) {
    membersByLayer.set(
      layer.id,
      generatePerimeter({
        pack,
        layer,
        product: productOf(layer),
        region,
        plane,
        zoneId: zone.id,
        issues,
      }),
    );
  }

  // 10. Bracing, where the pack has it switched on.
  for (const layer of active.filter(isBrace)) {
    membersByLayer.set(
      layer.id,
      generateBracing({
        pack,
        layer,
        product: productOf(layer),
        region: buildableRegion,
        plane,
        structurePlane,
        direction: dir.direction,
        systemDepth: pack.buildUp.systemDepth,
        zoneId: zone.id,
        issues,
      }),
    );
  }

  const members = [...membersByLayer.values()].flat().sort((a, b) => a.id.localeCompare(b.id));

  // Openings that still sit on a member after the nudge.
  const minClear = pack.penetration?.minClearOfMember ?? null;
  if (minClear !== null && split.untrimmed.length > 0) {
    const primary = ordered.find((l) => l.orientation === 'primary');
    const conflicts = clearanceConflicts(
      split.untrimmed,
      primary ? (membersByLayer.get(primary.id) ?? []) : [],
      minClear,
    );
    for (const c of conflicts) {
      issues.error(
        'PENETRATION_ON_MEMBER',
        `${c.penetration.kind} ${c.penetration.reference ?? c.penetration.id} clears the nearest member by ${Math.round(c.clearance)}mm, under the ${minClear}mm required. It needs moving, or the member needs cutting and trimming.`,
        {
          zoneId: zone.id,
          location: c.penetration.shape.centre,
          memberIds: [c.memberId],
          ruleId: 'penetration.minClearOfMember',
        },
      );
    }
  }

  // 11. Re-check everything against the pack.
  validate({
    pack,
    reader,
    zone,
    region,
    buildableRegion,
    members,
    issues,
    minHangerDrop: pack.buildUp.minHangerDrop,
    maxHangerDrop: pack.buildUp.maxHangerDrop,
  });

  const setout: SetoutDecision = {
    direction: dir.direction,
    directionDegrees: quantise(((Math.atan2(dir.direction.y, dir.direction.x) * 180) / Math.PI + 360) % 180),
    directionReason: dir.reason,
    origin: org.origin,
    originReason: org.reason,
    layerOrigins,
  };

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    region,
    buildableRegion,
    plane,
    structurePlane,
    setout,
    members,
    issues: issues.all().filter((i) => i.zoneId === zone.id),
    packKey,
    loadCaseId: zone.system.loadCase,
    spacings,
  };
}

