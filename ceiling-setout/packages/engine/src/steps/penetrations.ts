import {
  add,
  closestPointOnSegment,
  differenceAll,
  dot,
  normalise,
  outset,
  perp,
  quantise,
  scale,
  sub,
  type MultiPolygon,
  type Plane,
  type Segment,
  type Vec2,
} from '@ceiling/geometry';
import type { LineArrayLayer, PenetrationRule, Product, RulePack } from '@ceiling/rules';
import type { Penetration, Zone } from '../project.js';
import { trimmerMemberId } from '../identity.js';
import { makeMember, planSegment } from '../member.js';
import type { IssueLog } from '../issues.js';
import { provenance } from '../provenance.js';
import type { Member } from '../types.js';
import { penetrationArea, penetrationPolygon, penetrationWidth } from './resolveZone.js';

export interface PenetrationSplit {
  /** Openings big enough to cut the framing around, and therefore to trim. */
  readonly trimmed: readonly Penetration[];
  /** Openings small enough to pass through the lining without cutting a member. */
  readonly untrimmed: readonly Penetration[];
}

/**
 * Which openings are cut around and which merely pass through the lining.
 *
 * A downlight is drilled through a sheet and needs nothing but clearance from a
 * channel. A diffuser or an access panel interrupts the framing and needs trimmers
 * both sides. The threshold is the pack's, not the app's.
 */
export function classifyPenetrations(
  zone: Zone,
  rule: PenetrationRule | null,
  issues: IssueLog,
): PenetrationSplit {
  if (!rule) {
    if (zone.penetrations.length > 0) {
      issues.warn('NO_PENETRATION_RULE', 'the rule pack has no penetration rule, so no openings were trimmed', {
        zoneId: zone.id,
      });
    }
    return { trimmed: [], untrimmed: zone.penetrations };
  }
  if (rule.trimAboveArea === null && rule.trimAboveWidth === null) {
    issues.warn(
      'TRIM_THRESHOLD_NOT_ENTERED',
      'no trim threshold has been entered, so no openings were trimmed',
      { zoneId: zone.id, ruleId: 'penetration.trimAboveArea' },
    );
    return { trimmed: [], untrimmed: zone.penetrations };
  }

  const trimmed: Penetration[] = [];
  const untrimmed: Penetration[] = [];
  for (const p of zone.penetrations) {
    const area = penetrationArea(p.shape);
    const width = penetrationWidth(p.shape);
    const byArea = rule.trimAboveArea !== null && area > rule.trimAboveArea;
    const byWidth = rule.trimAboveWidth !== null && width > rule.trimAboveWidth;
    (byArea || byWidth ? trimmed : untrimmed).push(p);
  }
  return { trimmed, untrimmed };
}

/** The region with trimmed openings cut out, so members stop at their edges. */
export function cutOpenings(region: MultiPolygon, trimmed: readonly Penetration[], clearance: number): MultiPolygon {
  if (trimmed.length === 0) return region;
  const openings = trimmed.map((p) => {
    const poly = penetrationPolygon(p);
    return clearance > 0 ? outset(poly, clearance) : poly;
  });
  return differenceAll(region, openings);
}

export interface TrimmerParams {
  readonly pack: RulePack;
  readonly rule: PenetrationRule;
  readonly layer: LineArrayLayer;
  readonly product: Product | null;
  readonly primaryMembers: readonly Member[];
  readonly plane: Plane;
  readonly zone: Zone;
  readonly direction: Vec2;
  readonly issues: IssueLog;
}

/**
 * Step 8. Trimmers each side of an opening, spanning between the members it interrupts.
 *
 * The trimmer runs across the primary members, from the nearest uncut member on one
 * side to the nearest on the other, so it lands on something at both ends rather than
 * stopping in mid-air at the edge of the hole.
 */
export function generateTrimmers(params: TrimmerParams, trimmed: readonly Penetration[]): Member[] {
  const { rule, layer, plane, zone, direction, issues, pack } = params;
  const out: Member[] = [];
  const clearance = rule.clearance ?? 0;
  const u = normalise(direction);
  const n = perp(u);

  for (const pen of trimmed) {
    const centre = pen.shape.centre;
    const halfAlong = extentAlong(pen, u) / 2 + clearance;
    const halfAcross = extentAlong(pen, n) / 2 + clearance;

    // Members either side of the opening, measured across the primary direction.
    const flanks = flankingMembers(params.primaryMembers, centre, n, halfAcross);
    if (!flanks) {
      issues.warn(
        'TRIMMER_NO_SUPPORT',
        `${pen.kind} ${pen.reference ?? pen.id}: no members either side to trim between`,
        { zoneId: zone.id, location: centre },
      );
      continue;
    }

    const width = penetrationWidth(pen.shape);
    const doubled = rule.doubleAboveWidth !== null && width > rule.doubleAboveWidth;

    for (const side of [-1, 1] as const) {
      const offsetAlong = side * halfAlong;
      const base = add(centre, scale(u, offsetAlong));
      const a = add(base, scale(n, -flanks.negative));
      const b = add(base, scale(n, flanks.positive));
      const count = doubled ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const nudge = doubled ? (i === 0 ? 0 : side * (params.product?.width ?? 35)) : 0;
        const seg: Segment = {
          a: add(a, scale(u, nudge)),
          b: add(b, scale(u, nudge)),
        };
        out.push(
          makeMember({
            id: trimmerMemberId(zone.id, layer.id, pen.id, `${side > 0 ? 'far' : 'near'}${doubled ? i : ''}`),
            layer,
            product: params.product,
            segment: seg,
            plane,
            zoneId: zone.id,
            connectsTo: flanks.memberIds,
            provenance: provenance({
              pack,
              ruleId: doubled ? 'penetration.doubleAboveWidth' : 'penetration.trimAboveArea',
              reason: doubled
                ? `doubled trimmer to the ${pen.kind} ${pen.reference ?? pen.id}: the ${Math.round(width)}mm opening exceeds the ${rule.doubleAboveWidth}mm doubling width, at ${clearance}mm clearance`
                : `trimmer to the ${pen.kind} ${pen.reference ?? pen.id} at ${clearance}mm clearance`,
            }),
          }),
        );
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Plan extent of a penetration measured along a direction. */
function extentAlong(pen: Penetration, dir: Vec2): number {
  if (pen.shape.kind === 'circle') return pen.shape.radius * 2;
  const c = Math.cos(pen.shape.rotation);
  const s = Math.sin(pen.shape.rotation);
  const ax = { x: c, y: s };
  const ay = { x: -s, y: c };
  return Math.abs(dot(ax, dir)) * pen.shape.width + Math.abs(dot(ay, dir)) * pen.shape.height;
}

/** How far to reach either side of an opening to land on a member. */
function flankingMembers(
  members: readonly Member[],
  centre: Vec2,
  across: Vec2,
  minReach: number,
): { negative: number; positive: number; memberIds: string[] } | null {
  let negative = Infinity;
  let positive = Infinity;
  const ids: string[] = [];
  for (const m of members) {
    const seg = planSegment(m);
    const closest = closestPointOnSegment(centre, seg.a, seg.b);
    const offset = dot(sub(closest.point, centre), across);
    if (Math.abs(offset) < minReach - 1e-6) continue;
    if (offset < 0 && -offset < negative) {
      negative = -offset;
      ids[0] = m.id;
    }
    if (offset > 0 && offset < positive) {
      positive = offset;
      ids[1] = m.id;
    }
  }
  if (!Number.isFinite(negative) || !Number.isFinite(positive)) return null;
  return { negative: quantise(negative), positive: quantise(positive), memberIds: ids.filter(Boolean) };
}

export interface ClearanceConflict {
  readonly penetration: Penetration;
  readonly memberId: string;
  readonly clearance: number;
}

/**
 * Openings that land on or too near a member centreline.
 *
 * A downlight through a furring channel is not a drawing error to be noted later - it
 * is a hole that cannot be cut on site. The setout is nudged to avoid these where the
 * rules allow, and whatever remains is reported with its location.
 */
export function clearanceConflicts(
  penetrations: readonly Penetration[],
  members: readonly Member[],
  minClear: number,
): ClearanceConflict[] {
  const out: ClearanceConflict[] = [];
  for (const pen of penetrations) {
    const radius = penetrationWidth(pen.shape) / 2;
    for (const m of members) {
      const seg = planSegment(m);
      const d = closestPointOnSegment(pen.shape.centre, seg.a, seg.b).distance;
      const clear = d - radius;
      if (clear < minClear - 1e-6) {
        out.push({ penetration: pen, memberId: m.id, clearance: quantise(clear) });
      }
    }
  }
  return out.sort((a, b) => a.penetration.id.localeCompare(b.penetration.id) || a.memberId.localeCompare(b.memberId));
}
