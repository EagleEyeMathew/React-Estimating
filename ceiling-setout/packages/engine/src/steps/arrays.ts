import {
  EPS,
  cross,
  dist,
  distanceToNearestSegment,
  dot,
  lerp,
  lineArray,
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
  const { layer, resolution, region, direction, origin, issues, zoneId } = params;
  const spacing = resolution.spacing;
  if (spacing === null) {
    return { members: [], discarded: [], setbackOffsets: [] };
  }

  const minSegmentLength = layer.minSegmentLength ?? 0;
  const array = lineArray({ region, direction, spacing, origin, minSegmentLength });

  const members: Member[] = array.segments.map((s) =>
    buildMember(params, lineMemberId(zoneId, layer.id, s.lineIndex, s.segmentIndex), s, describeSpacing(layer, resolution)),
  );

  for (const d of array.discarded) {
    issues.warn(
      'MEMBER_TOO_SHORT',
      `${layer.id}: a ${Math.round(d.length)}mm piece was discarded as shorter than the ${minSegmentLength}mm minimum usable length`,
      { zoneId, location: d.a, ruleId: `layers.${layer.id}.minSegmentLength` },
    );
  }

  // Perimeter setback: add members against walls the lattice leaves unsupported.
  const setbackOffsets: number[] = [];
  const maxFromWall = layer.maxFromWall;
  if (maxFromWall !== null && maxFromWall > 0) {
    const existing = members.map(planSegment);
    const deficient = setbackDeficiencies(region, existing, direction, maxFromWall);
    for (const offsetPoint of deficient) {
      const extra = lineArray({
        region,
        direction,
        spacing,
        origin: offsetPoint,
        minSegmentLength,
        // One line only: the lattice is anchored on this point and nothing else fits
        // within the zone at this spacing that the main array has not already placed.
        maxLines: 100000,
      });
      const acrossAxis = perp(normalise(direction));
      const offset = quantise(dot(offsetPoint, acrossAxis));
      const onLine = extra.segments.filter((s) => s.lineIndex === 0);
      if (onLine.length === 0) continue;
      setbackOffsets.push(offset);
      for (const s of onLine) {
        members.push(
          buildMember(
            params,
            edgeMemberId(zoneId, layer.id, offset, s.segmentIndex),
            s,
            `added ${maxFromWall}mm off the wall: the ${spacing}mm lattice leaves no member within the setback here`,
            `layers.${layer.id}.maxFromWall`,
          ),
        );
      }
    }
  } else if (maxFromWall === null) {
    issues.warn(
      'SETBACK_NOT_ENTERED',
      `${layer.id}: no maximum distance from wall has been entered, so the perimeter setback was not checked`,
      { zoneId, ruleId: `layers.${layer.id}.maxFromWall` },
    );
  }

  return { members: sortMembers(members), discarded: array.discarded, setbackOffsets };
}

function describeSpacing(layer: LineArrayLayer, r: SpacingResolution): string {
  if (r.module !== null) {
    return `set out at the ${r.module}mm module for ${layer.id}`;
  }
  return `spaced at ${r.spacing}mm, the tightest of ${r.candidates.length} constraint(s)`;
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

const sortMembers = (m: Member[]): Member[] => [...m].sort((a, b) => a.id.localeCompare(b.id));

/**
 * Points on walls that run alongside the members but have no member within the
 * setback, returned as lattice origins for the lines that answer them.
 *
 * Walls running across the members are excluded: an unsupported member *end* is a
 * different defect with a different rule (end overhang), and adding a member parallel
 * to a wall it meets head-on would be nonsense.
 */
export function setbackDeficiencies(
  region: MultiPolygon,
  members: readonly Segment[],
  direction: Vec2,
  maxFromWall: number,
): Vec2[] {
  const u = normalise(direction);
  const found = new Map<number, Vec2>();
  const acrossAxis = perp(u);

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

        const steps = Math.max(1, Math.ceil(length / 500));
        for (let k = 0; k <= steps; k++) {
          const onWall = lerp(a, b, k / steps);
          const probe = add(onWall, scale(inward, Math.min(maxFromWall, 1)));
          if (members.length > 0 && distanceToNearestSegment(probe, members) <= maxFromWall) continue;
          const candidate = add(onWall, scale(inward, maxFromWall));
          const key = Math.round(dot(candidate, acrossAxis));
          if (!found.has(key)) found.set(key, candidate);
        }
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
