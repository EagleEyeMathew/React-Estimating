import {
  EPS,
  cross,
  dist,
  distanceToNearestSegment,
  dot,
  lerp,
  lineArray,
  singleLine,
  normalise,
  perp,
  quantise,
  scale,
  sub,
  add,
  type ArraySegment,
  type MultiPolygon,
  type Plane,
  type Ring,
  type Segment,
  type Vec2,
} from '@ceiling/geometry';
import { allRings } from '@ceiling/geometry';
import type { LineArrayLayer, Product, RulePack, SpacingResolution } from '@ceiling/rules';
import type { LatticePlan } from './lattice.js';
import { edgeMemberId, lineMemberId, splitMemberId } from '../identity.js';
import { makeMember, planSegment } from '../member.js';
import type { IssueLog } from '../issues.js';
import { spacingProvenance } from '../provenance.js';
import type { Member } from '../types.js';

export interface LineArrayParams {
  readonly pack: RulePack;
  readonly layer: LineArrayLayer;
  readonly product: Product | null;
  readonly resolution: SpacingResolution;
  /** The spacing and lattice line chosen for this layer. */
  readonly plan: LatticePlan;
  readonly region: MultiPolygon;
  readonly direction: Vec2;
  readonly origin: Vec2;
  readonly plane: Plane;
  readonly zoneId: string;
  readonly issues: IssueLog;
}

export interface LineArrayOutcome {
  readonly members: readonly Member[];
  readonly discarded: readonly ArraySegment[];
  /** Lines added purely to satisfy the perimeter setback rule. */
  readonly setbackOffsets: readonly number[];
}

/**
 * Steps 4 and 5. A family of members at the resolved spacing, clipped to the zone.
 *
 * Two things happen beyond the raw line array. Pieces shorter than the layer's
 * minimum usable length are dropped and reported rather than drawn as unbuildable
 * offcuts. And walls that run alongside the members but have no member within the
 * setback distance get one added - the balanced lattice satisfies that at the two
 * outer edges of a rectangle, but a concave room has interior walls the lattice knows
 * nothing about.
 */
export function generateLineArray(params: LineArrayParams): LineArrayOutcome {
  const { layer, resolution, plan, region, direction, origin, issues, zoneId } = params;
  if (resolution.spacing === null) {
    return { members: [], discarded: [], setbackOffsets: [] };
  }
  const spacing = plan.spacing;

  // Without a setback the lattice can only be centred on the zone, which is a guess
  // about where the members sit relative to the walls. The packs promise that a layer
  // whose required figures are blank is reported rather than generated, and this is
  // one of them.
  if (layer.maxFromWall === null) {
    issues.error(
      'SETBACK_NOT_ENTERED',
      `${layer.id}: no maximum distance from wall has been entered, so no members were generated - without it there is nothing to set the first member off the wall by`,
      { zoneId, ruleId: `layers.${layer.id}.maxFromWall` },
    );
    return { members: [], discarded: [], setbackOffsets: [] };
  }

  const minSegmentLength = layer.minSegmentLength ?? 0;
  const array = lineArray({ region, direction, spacing, origin, minSegmentLength });

  const members: Member[] = array.segments.map((s) =>
    buildMember(params, lineMemberId(zoneId, layer.id, s.lineIndex, s.segmentIndex), s, plan.reason),
  );

  for (const d of array.discarded) {
    issues.warn(
      'MEMBER_TOO_SHORT',
      `${layer.id}: a ${Math.round(d.length)}mm piece was discarded as shorter than the ${minSegmentLength}mm minimum usable length`,
      { zoneId, location: d.a, ruleId: `layers.${layer.id}.minSegmentLength` },
    );
  }

  // Perimeter setback: add members against walls the lattice leaves unsupported.
  //
  // Added one at a time, re-checking after each, because a wall that slopes even
  // slightly relative to the members produces a different deficient offset at every
  // point along it. Adding them all at once fans out a dozen near-coincident members;
  // adding one and re-checking usually satisfies the whole wall with that one.
  const setbackOffsets: number[] = [];
  const maxFromWall = layer.maxFromWall;
  const MAX_SETBACK_LINES = 12;

  if (layer.module !== null) {
    // A module layer gets no extra members at the wall. The module is the ceiling, and
    // the edge condition is a cut tile carried by the perimeter trim - putting a main
    // tee 50mm inside the last one to satisfy a setback would be a line on a drawing
    // and nothing on site. The margin is checked and reported instead.
    if (maxFromWall !== null && plan.firstFromWall !== null && plan.firstFromWall > maxFromWall + 1) {
      issues.warn(
        'EDGE_MARGIN_EXCEEDED',
        `${layer.id}: centring the ${layer.module}mm module leaves a ${Math.round(plan.firstFromWall)}mm margin at each edge, over the ${maxFromWall}mm this pack allows. The module cannot be changed to suit, so this needs a different module, an off-centre setout, or engineer review.`,
        { zoneId, ruleId: `layers.${layer.id}.maxFromWall` },
      );
    }
    return { members: sortMembers(members), discarded: array.discarded, setbackOffsets };
  }

  if (maxFromWall !== null && maxFromWall > 0) {
    const acrossAxis = perp(normalise(direction));
    for (let round = 0; round < MAX_SETBACK_LINES; round++) {
      const deficient = setbackDeficiencies(region, members.map(planSegment), direction, maxFromWall);
      const next = deficient[0];
      if (!next) break;
      const offset = quantise(dot(next, acrossAxis));
      if (setbackOffsets.includes(offset)) break;

      // Never put a member within a third of a bay of one that is already there. Two
      // channels 40mm apart satisfy the rule on paper and cannot be built, and a wall
      // that can only be answered that way is one the setout direction is wrong for -
      // which is a decision for the user, so it is reported rather than drawn.
      // Measured where the member would actually go, not by comparing offsets: in a
      // concave room a member at the same offset in another arm is nowhere near it.
      const existing = members.filter((m) => m.planLength > 0).map(planSegment);
      const tooClose = existing.length > 0 && distanceToNearestSegment(next, existing) < spacing / 3;
      if (tooClose) {
        issues.warn(
          'SETBACK_WOULD_DOUBLE_UP',
          `${layer.id}: this wall needs a member within ${maxFromWall}mm of it, but the nearest place to put one is under ${Math.round(spacing / 3)}mm from an existing member. It runs at too shallow an angle to the setout to be followed - run the setout the other way, or trim locally against this wall.`,
          { zoneId, location: next, ruleId: `layers.${layer.id}.maxFromWall` },
        );
        break;
      }
      const extra = singleLine({ region, direction, through: next, minSegmentLength });
      const onLine = extra.segments;
      if (onLine.length === 0) break;
      setbackOffsets.push(offset);
      for (const s of onLine) {
        members.push(
          buildMember(
            params,
            edgeMemberId(zoneId, layer.id, offset, s.segmentIndex),
            s,
            `added ${maxFromWall}mm off the wall: the ${round3(spacing)}mm setout leaves no member within the setback here`,
            `layers.${layer.id}.maxFromWall`,
          ),
        );
      }
    }
    if (setbackOffsets.length >= MAX_SETBACK_LINES) {
      issues.warn(
        'SETBACK_UNRESOLVED',
        `${layer.id}: the perimeter setback could not be satisfied with ${MAX_SETBACK_LINES} added members. A wall running at a shallow angle to the setout cannot be followed by members parallel to it - consider running the setout the other way or trimming locally.`,
        { zoneId, ruleId: `layers.${layer.id}.maxFromWall` },
      );
    }
  }

  return { members: sortMembers(members), discarded: array.discarded, setbackOffsets };
}

function buildMember(
  params: LineArrayParams,
  id: string,
  seg: ArraySegment | Segment,
  reason: string,
  ruleIdOverride?: string,
): Member {
  const prov = spacingProvenance(params.pack, params.resolution, reason);
  return makeMember({
    id,
    layer: params.layer,
    product: params.product,
    segment: { a: seg.a, b: seg.b },
    plane: params.plane,
    zoneId: params.zoneId,
    provenance: ruleIdOverride ? { ...prov, ruleId: ruleIdOverride } : prov,
  });
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const sortMembers = (m: Member[]): Member[] => [...m].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Where a member has to be added to satisfy the perimeter setback, one point per wall.
 *
 * Walls running across the members are excluded: an unsupported member *end* is a
 * different defect with a different rule (end overhang), and adding a member parallel
 * to a wall it meets head-on would be nonsense.
 *
 * For each wall that does need one, the offset is chosen by interval covering rather
 * than by answering the first deficient point found. Every deficient point on the wall
 * accepts a member anywhere between the wall itself and the setback distance in from
 * it; the offset picked is the one lying in the most of those intervals, breaking ties
 * towards the full setback. A wall parallel to the members has one interval, so the
 * member lands at the full setback where it belongs. A wall running at a slight angle
 * has a staircase of them, and this covers as much of it as one member can - which is
 * what stops a wall 200mm out of parallel growing a fan of members 20mm apart.
 */
export function setbackDeficiencies(
  region: MultiPolygon,
  members: readonly Segment[],
  direction: Vec2,
  maxFromWall: number,
): Vec2[] {
  const u = normalise(direction);
  const acrossAxis = perp(u);
  const found = new Map<number, Vec2>();

  // Outer rings only. A column or void needs a local trimmer at its edge, not a
  // member run right across the room, so the setback rule stops at the walls and the
  // validator reports any opening edge that ends up unsupported.
  for (const poly of region) {
    for (const ring of [poly.outer]) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        const length = dist(a, b);
        if (length < EPS) continue;
        const ed = normalise(sub(b, a));
        // Only walls within 45 degrees of the member direction get a parallel member.
        if (Math.abs(cross(ed, u)) > Math.SQRT1_2) continue;
        // Interior is on the left of every ring in canonical form: outer rings run
        // counter-clockwise and holes clockwise, so the same normal points inward for both.
        const inward = perp(ed);
        const inwardSign = dot(inward, acrossAxis) >= 0 ? 1 : -1;

        const deficient: { at: Vec2; wallAcross: number }[] = [];
        const steps = Math.max(1, Math.ceil(length / 500));
        for (let k = 0; k <= steps; k++) {
          const onWall = lerp(a, b, k / steps);
          const probe = add(onWall, scale(inward, Math.min(maxFromWall, 1)));
          if (members.length > 0 && distanceToNearestSegment(probe, members) <= maxFromWall) continue;
          deficient.push({ at: onWall, wallAcross: dot(onWall, acrossAxis) });
        }
        if (deficient.length === 0) continue;

        // Candidate offsets: the full setback in from each deficient point. The one
        // covering the most points wins; among equals, the one furthest from the wall.
        const candidates = deficient.map((d) => d.wallAcross + inwardSign * maxFromWall);
        let bestOffset = candidates[0]!;
        let bestCover = -1;
        for (const candidate of candidates) {
          const cover = deficient.filter((d) => {
            const inFromWall = (candidate - d.wallAcross) * inwardSign;
            return inFromWall >= -1e-6 && inFromWall <= maxFromWall + 1e-6;
          }).length;
          const further = (candidate - deficient[0]!.wallAcross) * inwardSign;
          const bestFurther = (bestOffset - deficient[0]!.wallAcross) * inwardSign;
          if (cover > bestCover || (cover === bestCover && further > bestFurther)) {
            bestCover = cover;
            bestOffset = candidate;
          }
        }

        // Any point on that offset line will do; take one over the middle of the wall.
        const mid = lerp(a, b, 0.5);
        const shift = bestOffset - dot(mid, acrossAxis);
        const point = add(mid, scale(acrossAxis, shift));
        const key = Math.round(bestOffset);
        if (!found.has(key)) found.set(key, point);
      }
    }
  }
  return [...found.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v);
}

/**
 * Cut members at their crossings with another layer.
 *
 * Exposed grid cross tees are supplied as modular pieces between main tees, not as
 * continuous lengths, so a schedule that lists them as long runs would order the
 * wrong product.
 */
export function splitAtCrossings(members: readonly Member[], cutters: readonly Member[], plane: Plane): Member[] {
  if (cutters.length === 0) return [...members];
  const cutterSegments = cutters.map(planSegment);
  const out: Member[] = [];

  for (const m of members) {
    const seg = planSegment(m);
    const total = dist(seg.a, seg.b);
    if (total < EPS) {
      out.push(m);
      continue;
    }
    const u = normalise(sub(seg.b, seg.a));
    const cuts = new Set<number>([0, total]);
    for (const c of cutterSegments) {
      const t = intersectionParameter(seg, c);
      if (t !== null && t > EPS && t < total - EPS) cuts.add(quantise(t));
    }
    const ordered = [...cuts].sort((x, y) => x - y);
    if (ordered.length === 2) {
      out.push(m);
      continue;
    }
    for (let i = 0; i < ordered.length - 1; i++) {
      const t0 = ordered[i]!;
      const t1 = ordered[i + 1]!;
      if (t1 - t0 < EPS) continue;
      const a = add(seg.a, scale(u, t0));
      const b = add(seg.a, scale(u, t1));
      out.push({
        ...m,
        id: splitMemberId(m.id, i),
        start: { x: quantise(a.x), y: quantise(a.y), z: m.start.z },
        end: { x: quantise(b.x), y: quantise(b.y), z: m.end.z },
        length: quantise((m.length * (t1 - t0)) / total),
        planLength: quantise(t1 - t0),
        provenance: {
          ...m.provenance,
          reason: `${m.provenance.reason}; cut into modular pieces at every crossing`,
        },
      });
    }
  }
  return sortMembers(out);
}

/** Distance along `seg` at which it crosses `other`, or null if they do not cross. */
export function intersectionParameter(seg: Segment, other: Segment): number | null {
  const r = sub(seg.b, seg.a);
  const s = sub(other.b, other.a);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(other.a, seg.a);
  const t = cross(qp, s) / denom;
  const v = cross(qp, r) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || v < -1e-9 || v > 1 + 1e-9) return null;
  return t * Math.hypot(r.x, r.y);
}

/** Points where a member crosses any member of another layer, as distances along it. */
export function crossingsAlong(member: Member, others: readonly Member[]): { distance: number; memberId: string }[] {
  const seg = planSegment(member);
  const out: { distance: number; memberId: string }[] = [];
  for (const o of others) {
    const t = intersectionParameter(seg, planSegment(o));
    if (t !== null) out.push({ distance: quantise(t), memberId: o.id });
  }
  return out.sort((a, b) => a.distance - b.distance || a.memberId.localeCompare(b.memberId));
}

export { allRings };
