import {
  allRings,
  coverage,
  dist,
  distanceToNearestSegment,
  lerp,
  normalise,
  perp,
  add,
  scale,
  cross,
  sub,
  excursionDepth,
  holePenetrationDepth,
  multiPolygonArea,
  quantise,
  type MultiPolygon,
  type Segment,
} from '@ceiling/geometry';
import type { RulePack } from '@ceiling/rules';
import { PackReader, isLineArray, resolveSpacing, resolveSpan } from '@ceiling/rules';
import type { Zone } from '../project.js';
import { isPointMember, planSegment } from '../member.js';
import type { IssueLog } from '../issues.js';
import type { Member } from '../types.js';
import { crossingsAlong } from './arrays.js';

export interface ValidateParams {
  readonly pack: RulePack;
  readonly reader: PackReader;
  readonly zone: Zone;
  readonly region: MultiPolygon;
  readonly buildableRegion: MultiPolygon;
  readonly members: readonly Member[];
  readonly issues: IssueLog;
  readonly minHangerDrop: number | null;
  readonly maxHangerDrop: number | null;
}

/**
 * Step 11. Re-check the generated setout against the rules that produced it.
 *
 * Everything here is checked on the finished members rather than trusted from the
 * generation step, because manual overrides, penetration cuts and structure snapping
 * all move members after they are placed. A drawing is only defensible if the checks
 * ran on what is actually drawn.
 */
export function validate(params: ValidateParams): void {
  const { pack, reader, zone, region, members, issues } = params;
  const byLayer = new Map<string, Member[]>();
  for (const m of members) {
    const list = byLayer.get(m.layerId) ?? [];
    list.push(m);
    byLayer.set(m.layerId, list);
  }

  checkContainment(params);
  checkSpansAndOverhangs(params, byLayer);
  checkCoverage(params, byLayer);
  checkOpeningEdges(params, byLayer);
  checkHangerDrops(params);

  // A fixed module that breaches a span limit cannot be fixed by tightening the
  // spacing, so it is the user's decision - but it must be on the drawing.
  for (const layer of pack.layers) {
    if (!isLineArray(layer) || !layer.enabled || zone.disabledLayers.includes(layer.id)) continue;
    const r = resolveSpacing(reader, layer.id);
    if (r.moduleExceedsLimit) {
      const tightest = r.candidates.reduce((a, b) => (a.value <= b.value ? a : b));
      issues.error(
        'MODULE_EXCEEDS_LIMIT',
        `${layer.id}: the ${r.module}mm module exceeds the ${tightest.value}mm limit from ${tightest.path}. The module cannot be reduced without changing the ceiling, so this needs a different product, a tighter load case, or engineer review.`,
        { zoneId: zone.id, ruleId: tightest.path },
      );
    }
  }

  for (const gap of reader.missing) {
    issues.error('RULE_VALUE_MISSING', `${gap.description}`, { zoneId: zone.id, ruleId: gap.path });
  }
}

/** No member outside the zone, and none through a column or void. */
function checkContainment(params: ValidateParams): void {
  const { members, region, buildableRegion, issues, zone } = params;
  for (const m of members) {
    if (isPointMember(m) || m.type === 'bridging' || m.type === 'brace') continue;
    const seg = planSegment(m);
    const outside = excursionDepth(seg, region);
    if (outside > 1) {
      issues.error(
        'MEMBER_OUTSIDE_ZONE',
        `${m.layerId}: this member runs ${Math.round(outside)}mm outside the zone boundary`,
        { zoneId: zone.id, location: m.start, memberIds: [m.id] },
      );
    }
    const throughHole = holePenetrationDepth(seg, region);
    if (throughHole > 1) {
      issues.error(
        'MEMBER_THROUGH_OPENING',
        `${m.layerId}: this member passes ${Math.round(throughHole)}mm through a column or void`,
        { zoneId: zone.id, location: m.start, memberIds: [m.id] },
      );
    }
    if (buildableRegion !== region) {
      const throughOpening = holePenetrationDepth(seg, buildableRegion);
      if (throughOpening > 1 && throughHole <= 1) {
        issues.warn(
          'MEMBER_THROUGH_PENETRATION',
          `${m.layerId}: this member crosses a trimmed opening by ${Math.round(throughOpening)}mm`,
          { zoneId: zone.id, location: m.start, memberIds: [m.id] },
        );
      }
    }
  }
}

/** Every span between supports, and every unsupported end, against the pack. */
function checkSpansAndOverhangs(params: ValidateParams, byLayer: Map<string, Member[]>): void {
  const { pack, reader, zone, issues } = params;
  for (const layer of pack.layers) {
    if (!isLineArray(layer) || layer.supportedBy === null) continue;
    if (!layer.enabled || zone.disabledLayers.includes(layer.id)) continue;
    const span = resolveSpan(reader, layer.id);
    const supports = byLayer.get(layer.supportedBy) ?? [];
    const overhang = layer.maxEndOverhang;
    const all = params.members;
    // Anything that names a member in connectsTo bears on it there. A furring stub
    // beside an opening ends on the trimmer that was set out for it, not in mid-air,
    // and counting only crossings with the nominal supporting layer would report
    // every one of them as a metre of unsupported cantilever.
    const extraSupports = new Map<string, Member[]>();
    for (const other of all) {
      if (other.planLength === 0) continue;
      for (const id of other.connectsTo) {
        const list = extraSupports.get(id) ?? [];
        list.push(other);
        extraSupports.set(id, list);
      }
    }

    for (const m of byLayer.get(layer.id) ?? []) {
      const crossings = crossingsAlong(m, [...supports, ...(extraSupports.get(m.id) ?? [])]);
      if (crossings.length === 0) {
        // A trimmer crosses no TSR, and should not: it spans between the two members
        // it was set out against, which it names in connectsTo. Checking only for a
        // crossing would call every trimmer unsupported and bury the real ones.
        const carriers = m.connectsTo
          .map((id) => all.find((x) => x.id === id))
          .filter((x): x is Member => x !== undefined && x.planLength > 0);
        if (carriers.length >= 2) {
          if (span !== null && m.planLength > span.value + 1) {
            issues.error(
              'SPAN_EXCEEDED',
              `${layer.id}: this member spans ${Math.round(m.planLength)}mm between the members it lands on, over the ${span.value}mm limit`,
              { zoneId: zone.id, location: m.start, memberIds: [m.id], ruleId: span.path },
            );
          }
          continue;
        }
        issues.error(
          'MEMBER_UNSUPPORTED',
          `${layer.id}: this member crosses no ${layer.supportedBy}, and lands on nothing else either, so it has no support`,
          { zoneId: zone.id, location: m.start, memberIds: [m.id] },
        );
        continue;
      }
      if (span !== null) {
        for (let i = 1; i < crossings.length; i++) {
          const gap = crossings[i]!.distance - crossings[i - 1]!.distance;
          if (gap > span.value + 1) {
            issues.error(
              'SPAN_EXCEEDED',
              `${layer.id}: a ${Math.round(gap)}mm span between ${layer.supportedBy} supports exceeds the ${span.value}mm limit`,
              { zoneId: zone.id, location: m.start, memberIds: [m.id], ruleId: span.path },
            );
          }
        }
      }
      if (overhang !== null) {
        const first = crossings[0]!.distance;
        const last = crossings[crossings.length - 1]!.distance;
        if (first > overhang + 1) {
          issues.warn(
            'END_OVERHANG',
            `${layer.id}: ${Math.round(first)}mm of unsupported member past the first ${layer.supportedBy}, over the ${overhang}mm limit`,
            { zoneId: zone.id, location: m.start, memberIds: [m.id], ruleId: `layers.${layer.id}.maxEndOverhang` },
          );
        }
        if (m.planLength - last > overhang + 1) {
          issues.warn(
            'END_OVERHANG',
            `${layer.id}: ${Math.round(m.planLength - last)}mm of unsupported member past the last ${layer.supportedBy}, over the ${overhang}mm limit`,
            { zoneId: zone.id, location: m.end, memberIds: [m.id], ruleId: `layers.${layer.id}.maxEndOverhang` },
          );
        }
      }
    }
  }
}

/**
 * Any part of the ceiling further from a supporting member than half a spacing.
 *
 * A concave room can leave a narrow strip between two lattice lines with nothing in
 * it. The line array cannot fix that on its own - there is no line there to clip - so
 * the setout is reported as deficient at that location rather than shipped quietly.
 */
function checkCoverage(params: ValidateParams, byLayer: Map<string, Member[]>): void {
  const { pack, reader, zone, buildableRegion, issues } = params;
  for (const layer of pack.layers) {
    if (!isLineArray(layer) || layer.orientation !== 'primary') continue;
    if (!layer.enabled || zone.disabledLayers.includes(layer.id)) continue;
    const r = resolveSpacing(reader, layer.id);
    if (r.spacing === null) continue;
    const segs: Segment[] = (byLayer.get(layer.id) ?? []).map(planSegment);
    if (segs.length === 0) continue;
    const allowed = r.spacing / 2 + (layer.maxFromWall ?? 0);
    const result = coverage(buildableRegion, segs, Math.max(50, r.spacing / 4));
    if (result.maxDistance > allowed + 1 && result.worstPoint) {
      issues.error(
        'UNSUPPORTED_AREA',
        `${layer.id}: part of the ceiling is ${Math.round(result.maxDistance)}mm from the nearest member, over the ${Math.round(allowed)}mm this setout allows. A member cannot reach here at ${r.spacing}mm centres - it needs a local trimmer or a change of direction.`,
        { zoneId: zone.id, location: result.worstPoint, ruleId: r.governedBy },
      );
    }
  }
}

/**
 * Opening edges with no member near enough to support the lining.
 *
 * The perimeter setback rule adds members along walls, but deliberately not around
 * columns and voids: a full-length member right across the room is the wrong answer
 * to a 600mm column. The right answer is a local trimmer, and that is a decision with
 * a fixing detail behind it - so the edge is reported with its location rather than
 * being guessed at here.
 */
function checkOpeningEdges(params: ValidateParams, byLayer: Map<string, Member[]>): void {
  const { pack, reader, zone, region, issues } = params;
  for (const layer of pack.layers) {
    if (!isLineArray(layer) || layer.orientation !== 'primary') continue;
    if (!layer.enabled || zone.disabledLayers.includes(layer.id)) continue;
    const maxFromWall = layer.maxFromWall;
    if (maxFromWall === null) continue;
    const r = resolveSpacing(reader, layer.id);
    if (r.spacing === null) continue;
    const segs = (byLayer.get(layer.id) ?? []).map(planSegment);
    if (segs.length === 0) continue;
    const direction = normalise({ x: segs[0]!.b.x - segs[0]!.a.x, y: segs[0]!.b.y - segs[0]!.a.y });

    const reported = new Set<string>();
    for (const poly of region) {
      for (const ring of allRings(poly).slice(1)) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!;
          const b = ring[(i + 1) % ring.length]!;
          const length = dist(a, b);
          if (length < 1) continue;
          const ed = normalise(sub(b, a));
          // Only edges running alongside the members need a parallel member near them.
          if (Math.abs(cross(ed, direction)) > Math.SQRT1_2) continue;
          const inward = perp(ed);
          const mid = lerp(a, b, 0.5);
          const probe = add(mid, scale(inward, Math.min(maxFromWall, 10)));
          if (distanceToNearestSegment(probe, segs) <= maxFromWall) continue;
          const key = `${Math.round(mid.x / 500)}:${Math.round(mid.y / 500)}`;
          if (reported.has(key)) continue;
          reported.add(key);
          issues.warn(
            'OPENING_EDGE_UNSUPPORTED',
            `${layer.id}: the lining edge at this opening has no member within ${maxFromWall}mm. It needs a local trimmer - the setback rule deliberately does not run a full member across the zone for an opening.`,
            { zoneId: zone.id, location: mid, ruleId: `layers.${layer.id}.maxFromWall` },
          );
        }
      }
    }
  }
}

/** Drops against the pack's minimum and maximum. */
function checkHangerDrops(params: ValidateParams): void {
  const { members, issues, zone, minHangerDrop, maxHangerDrop } = params;
  for (const m of members) {
    if (m.type !== 'hanger') continue;
    const drop = m.length;
    if (minHangerDrop !== null && drop < minHangerDrop - 1) {
      issues.warn(
        'HANGER_TOO_SHORT',
        `a ${Math.round(drop)}mm drop is below the ${minHangerDrop}mm minimum for this system`,
        { zoneId: zone.id, location: m.start, memberIds: [m.id], ruleId: 'buildUp.minHangerDrop' },
      );
    }
    if (maxHangerDrop !== null && drop > maxHangerDrop + 1) {
      issues.error(
        'HANGER_TOO_LONG',
        `a ${Math.round(drop)}mm drop exceeds the ${maxHangerDrop}mm maximum for this system; this needs bracing or a different suspension, and engineer review`,
        { zoneId: zone.id, location: m.start, memberIds: [m.id], ruleId: 'buildUp.maxHangerDrop' },
      );
    }
  }
}

export { multiPolygonArea, dist, quantise };
