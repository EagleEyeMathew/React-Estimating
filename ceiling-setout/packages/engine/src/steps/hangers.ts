import {
  EPS,
  add,
  dist,
  distributeAlong,
  dot,
  normalise,
  perp,
  planeZ,
  pointAt,
  quantise,
  scale,
  sub,
  type Plane,
  type Segment,
  type Vec2,
} from '@ceiling/geometry';
import type { AlongMemberLayer, Product, RulePack } from '@ceiling/rules';
import { isDiscreteStructure, structureMemberNoun, type Structure, type Zone } from '../project.js';
import { alongMemberId, bridgingMemberId } from '../identity.js';
import { makeMember, makePointMember, planSegment } from '../member.js';
import type { IssueLog } from '../issues.js';
import { provenance } from '../provenance.js';
import type { FixingSpec, Member } from '../types.js';
import { crossingsAlong } from './arrays.js';

export interface HangerParams {
  readonly pack: RulePack;
  readonly layer: AlongMemberLayer;
  readonly product: Product | null;
  readonly hosts: readonly Member[];
  /** Members of the layer named by `atCrossingsWith`, if any. */
  readonly crossing: readonly Member[];
  readonly plane: Plane;
  readonly structure: Structure;
  readonly structurePlane: Plane;
  readonly zone: Zone;
  readonly systemDepth: number | null;
  readonly issues: IssueLog;
}

export interface HangerOutcome {
  readonly members: readonly Member[];
  /** Members added to span between structural supports. */
  readonly bridging: readonly Member[];
}

/**
 * Steps 6 and 7. Points along a host member, snapped to available structure, with
 * their drops computed.
 *
 * Both ends of every host member get a fixing within the first-from-end rule,
 * including ends created by a hole rather than by a wall - an unsupported end over a
 * void is the same defect as one at a wall, and the array upstream has already split
 * the member there, so it is handled without a special case.
 */
export function generateAlongMember(params: HangerParams): HangerOutcome {
  const { layer, hosts, plane, zone, issues } = params;
  const members: Member[] = [];
  const bridging: Member[] = [];

  const maxSpacing = layer.maxSpacing;
  const firstFromEnd = layer.firstFromEnd;
  const isSuspension = layer.memberType === 'hanger';

  if (layer.atCrossingsWith === null && (maxSpacing === null || firstFromEnd === null)) {
    if (maxSpacing === null) {
      issues.error('SPACING_NOT_ENTERED', `${layer.id}: no maximum spacing has been entered, so none were placed`, {
        zoneId: zone.id,
        ruleId: `layers.${layer.id}.maxSpacing`,
      });
    }
    if (firstFromEnd === null) {
      issues.error('FIRST_FROM_END_NOT_ENTERED', `${layer.id}: no first-from-end distance has been entered, so none were placed`, {
        zoneId: zone.id,
        ruleId: `layers.${layer.id}.firstFromEnd`,
      });
    }
    return { members: [], bridging: [] };
  }

  for (const host of hosts) {
    const seg = planSegment(host);
    const length = host.planLength;
    if (length < EPS) continue;

    const positions: { distance: number; reason: string; ruleId: string }[] = [];

    if (layer.atCrossingsWith !== null) {
      // Clips and the like sit at every crossing, not on a spacing of their own.
      for (const c of crossingsAlong(host, params.crossing)) {
        positions.push({
          distance: c.distance,
          reason: `at the crossing with ${layer.atCrossingsWith}`,
          ruleId: `layers.${layer.id}.atCrossingsWith`,
        });
      }
    } else {
      for (const d of distributeAlong(length, maxSpacing!, firstFromEnd!)) {
        const atEnd = d <= firstFromEnd! + EPS || d >= length - firstFromEnd! - EPS;
        positions.push({
          distance: d,
          reason: atEnd
            ? `${Math.round(Math.min(d, length - d))}mm from a free end of ${host.layerId}, within the ${firstFromEnd}mm rule`
            : `at ${Math.round(maxSpacing! === 0 ? 0 : d)}mm along ${host.layerId}, no gap over ${maxSpacing}mm`,
          ruleId: atEnd ? `layers.${layer.id}.firstFromEnd` : `layers.${layer.id}.maxSpacing`,
        });
      }
    }

    const snapped = isSuspension
      ? snapToStructure(positions, seg, params, host)
      : positions.map((p) => ({ ...p, snapNote: null as string | null, needsBridging: false }));

    for (const p of snapped) {
      const at = pointAt(seg, p.distance);
      const id = alongMemberId(layer.id, host.id, p.distance);
      const ceilingLevel = planeZ(plane, at);
      const bottom = isSuspension
        ? ceilingLevel + (params.systemDepth ?? host.start.z - ceilingLevel)
        : ceilingLevel + (layer.heightAboveFcl ?? 0);
      const top = isSuspension ? planeZ(params.structurePlane, at) : bottom;

      if (isSuspension && p.needsBridging) {
        const bridge = makeBridging(params, host, at, id);
        if (bridge) bridging.push(bridge);
      }

      const drop = top - bottom;
      const fixing: FixingSpec = {
        type: layer.fixings.type,
        substrate: p.needsBridging ? 'bridging member' : structureSubstrate(params.structure, layer.fixings.substrate),
        count: layer.fixings.countPerConnection ?? 1,
        productCode: layer.fixings.productCode,
        at: { x: at.x, y: at.y, z: quantise(top) },
      };

      members.push(
        makePointMember({
          id,
          layer,
          product: params.product,
          at,
          top,
          bottom,
          // A hanger is round and hangs plumb, so its rotation means nothing; a clip
          // straddles its host and has to turn with it.
          rotation: isSuspension ? 0 : host.rotation,
          plane,
          zoneId: zone.id,
          connectsTo: [host.id],
          fixings: [fixing],
          provenance: provenance({
            pack: params.pack,
            ruleId: p.ruleId,
            reason: p.snapNote ? `${p.reason}; ${p.snapNote}` : p.reason,
            spacingUsed: maxSpacing,
          }),
        }),
      );

      if (isSuspension && drop < -EPS) {
        issues.error(
          'NEGATIVE_DROP',
          `${layer.id}: the structure at this point is below the ceiling build-up, giving a drop of ${Math.round(drop)}mm`,
          { zoneId: zone.id, location: { x: at.x, y: at.y, z: quantise(top) }, memberIds: [id] },
        );
      }
    }
  }

  return { members: sortById(members), bridging: sortById(bridging) };
}

function structureSubstrate(structure: Structure, fallback: string | null): string | null {
  switch (structure.kind) {
    case 'slab':
      return fallback ?? 'concrete soffit';
    case 'purlins':
      return fallback ?? 'steel purlin';
    case 'joists':
      return fallback ?? 'timber joist';
    case 'existing_ceiling':
      return fallback ?? 'existing ceiling';
  }
}

interface SnappedPosition {
  readonly distance: number;
  readonly reason: string;
  readonly ruleId: string;
  readonly snapNote: string | null;
  readonly needsBridging: boolean;
}

/**
 * Move each hanger onto a structural member, where the structure is discrete.
 *
 * A slab takes a fixing anywhere, so nothing moves. Purlins and joists do not: a
 * hanger between two purlins has nothing to fix to. The crossings of the host member
 * with the structure are the only usable positions, so the walk below takes the
 * furthest crossing still within the maximum spacing each time, which puts in the
 * fewest hangers that satisfy the rule. Where no crossing is reachable the position is
 * kept and marked for a bridging member, and reported either way.
 */
function snapToStructure(
  positions: readonly { distance: number; reason: string; ruleId: string }[],
  seg: Segment,
  params: HangerParams,
  host: Member,
): SnappedPosition[] {
  const { structure, zone, issues, layer } = params;
  if (!isDiscreteStructure(structure)) {
    return positions.map((p) => ({ ...p, snapNote: null, needsBridging: false }));
  }

  const crossings = structureCrossings(seg, structure);
  const length = host.planLength;
  const maxSpacing = layer.maxSpacing ?? Infinity;
  const firstFromEnd = layer.firstFromEnd ?? 0;
  const tolerance = zone.structureSnapTolerance;

  if (crossings.length === 0) {
    issues.error(
      'NO_STRUCTURE_OVER_MEMBER',
      `${layer.id}: no ${structureMemberNoun(structure)} crosses this ${host.layerId}, so every hanger on it needs a bridging member`,
      { zoneId: zone.id, location: seg.a, memberIds: [host.id] },
    );
    return positions.map((p) => ({ ...p, snapNote: 'no structure over this member', needsBridging: true }));
  }

  const out: SnappedPosition[] = [];
  let previous = -Infinity;
  // The last fixing must land within firstFromEnd of the far end, so the walk aims at
  // that target and takes the furthest reachable crossing on the way.
  const targets = positions.map((p) => p.distance);
  const lastTarget = Math.max(length - firstFromEnd, 0);

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    const source = positions[i]!;
    const reachableCeiling = previous === -Infinity ? Infinity : previous + maxSpacing;
    // Prefer the crossing closest to where the rule wanted the hanger, among those
    // that keep the spacing legal.
    const legal = crossings.filter((c) => c <= reachableCeiling + 1e-6 && c > previous + 1e-6);
    const pool = legal.length > 0 ? legal : crossings;
    let best = pool[0]!;
    for (const c of pool) if (Math.abs(c - target) < Math.abs(best - target) - 1e-9) best = c;

    const moved = Math.abs(best - target);
    const reachable = legal.length > 0 && moved <= Math.max(tolerance, maxSpacing);
    if (!reachable) {
      out.push({ ...source, snapNote: `no ${structureMemberNoun(structure)} within reach`, needsBridging: true });
      // Info, not a warning: a bridging member is generated for it, appears in the
      // schedules and carries in its provenance that the engineer sizes it. The
      // summary issue for the zone is what asks the user to look at them as a set.
      issues.info(
        'HANGER_NEEDS_BRIDGING',
        `${layer.id}: no ${structureMemberNoun(structure)} within ${Math.round(tolerance)}mm of the hanger position ${Math.round(target)}mm along ${host.layerId}, so a bridging member was added`,
        { zoneId: zone.id, location: pointAt(seg, target), memberIds: [host.id] },
      );
      previous = target;
      continue;
    }

    if (out.some((o) => Math.abs(o.distance - best) < 1e-6)) {
      previous = best;
      continue;
    }
    out.push({
      ...source,
      distance: quantise(best),
      snapNote:
        moved > 1e-6
          ? `moved ${Math.round(moved)}mm to land on a ${structureMemberNoun(structure)}`
          : `lands on a ${structureMemberNoun(structure)}`,
      needsBridging: false,
    });
    previous = best;
  }

  // Make sure the run still ends within the first-from-end rule after snapping.
  const last = out[out.length - 1];
  if (last && lastTarget - last.distance > maxSpacing + 1e-6) {
    issues.warn(
      'UNSUPPORTED_END_AFTER_SNAP',
      `${layer.id}: after snapping to structure the last hanger is ${Math.round(length - last.distance)}mm from the end of ${host.layerId}`,
      { zoneId: zone.id, location: pointAt(seg, length), memberIds: [host.id] },
    );
  }
  return out;
}

/** Distances along `seg` at which it crosses a purlin or joist. */
export function structureCrossings(seg: Segment, structure: Structure): number[] {
  if (!isDiscreteStructure(structure)) return [];
  const u = normalise(structure.direction);
  const n = perp(u);
  const a0 = dot(seg.a, n) - structure.offset;
  const a1 = dot(seg.b, n) - structure.offset;
  const length = dist(seg.a, seg.b);
  if (length < EPS) return [];
  const span = a1 - a0;
  if (Math.abs(span) < EPS) {
    // The member runs parallel to the structure: it either sits on one or on none.
    const nearest = Math.round(a0 / structure.spacing) * structure.spacing;
    return Math.abs(a0 - nearest) <= structure.width / 2 ? [0, length] : [];
  }
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const kMin = Math.ceil(lo / structure.spacing - 1e-9);
  const kMax = Math.floor(hi / structure.spacing + 1e-9);
  const out: number[] = [];
  for (let k = kMin; k <= kMax; k++) {
    const t = (k * structure.spacing - a0) / span;
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push(quantise(Math.min(Math.max(t, 0), 1) * length));
  }
  return out.sort((x, y) => x - y);
}

/**
 * A member spanning between the two nearest structural supports, so a hanger with
 * nothing above it has something to fix to. Emitted rather than silently omitted:
 * it is real material that has to be ordered and installed.
 */
function makeBridging(params: HangerParams, host: Member, at: Vec2, hangerId: string): Member | null {
  const { structure, zone } = params;
  if (!isDiscreteStructure(structure)) return null;
  const u = normalise(structure.direction);
  const n = perp(u);
  const across = dot(at, n) - structure.offset;
  const k = Math.floor(across / structure.spacing);
  const before = k * structure.spacing + structure.offset;
  const after = (k + 1) * structure.spacing + structure.offset;
  // Span perpendicular to the structure, from one member to the next, through the hanger.
  const alongAt = dot(at, u);
  const a = add(scale(n, before), scale(u, alongAt));
  const b = add(scale(n, after), scale(u, alongAt));

  return makeMember({
    id: bridgingMemberId(zone.id, hangerId),
    layer: { ...params.layer, id: 'bridging', memberType: 'bridging' },
    product: null,
    segment: { a, b },
    plane: params.structurePlane,
    zoneId: zone.id,
    heightAboveFcl: 0,
    connectsTo: [hangerId, host.id],
    provenance: provenance({
      pack: params.pack,
      ruleId: 'structure.bridging',
      reason: `spans ${Math.round(dist(a, b))}mm between ${structure.kind} so the hanger has a fixing point; size and fixing to be confirmed by the engineer`,
    }),
  });
}

const sortById = (m: Member[]): Member[] => [...m].sort((a, b) => a.id.localeCompare(b.id));

export { sub, add, scale };
