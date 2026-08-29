import {
  coverage,
  dist,
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
    for (const m of byLayer.get(layer.id) ?? []) {
      const crossings = crossingsAlong(m, supports);
      if (crossings.length === 0) {
        issues.error(
          'MEMBER_UNSUPPORTED',
          `${layer.id}: this member crosses no ${layer.supportedBy} at all, so it has no support`,
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
