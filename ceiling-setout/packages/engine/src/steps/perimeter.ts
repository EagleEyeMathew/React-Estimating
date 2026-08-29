import {
  EPS,
  allRings,
  angleOf,
  cross,
  dist,
  distributeAlong,
  normalise,
  planeZ,
  quantise,
  sub,
  type MultiPolygon,
  type Plane,
  type Ring,
  type Vec2,
  type Vec3,
} from '@ceiling/geometry';
import type { PerimeterLayer, Product, RulePack } from '@ceiling/rules';
import { perimeterMemberId } from '../identity.js';
import { makeMember } from '../member.js';
import type { IssueLog } from '../issues.js';
import { provenance } from '../provenance.js';
import type { FixingSpec, Member } from '../types.js';

export interface PerimeterParams {
  readonly pack: RulePack;
  readonly layer: PerimeterLayer;
  readonly product: Product | null;
  readonly region: MultiPolygon;
  readonly plane: Plane;
  readonly zoneId: string;
  readonly issues: IssueLog;
}

/** One run of trim: a straight wall, or a continuous curve around a column. */
export interface TrimRun {
  readonly a: Vec2;
  readonly b: Vec2;
  /** Every vertex, so a curved run can be drawn as it really is. */
  readonly points: readonly Vec2[];
  /** Length along the polyline, which is what gets cut. */
  readonly length: number;
  readonly curved: boolean;
  /** Total turn across the run, in degrees. */
  readonly turn: number;
}

/**
 * Step 9. Wall angle or shadowline around the zone, as one run per wall.
 *
 * Runs are per wall, not per tessellated edge. A straight wall broken into segments by
 * the boolean operations upstream still schedules as one cut length, and a round
 * column approximated by thirty-two chords schedules as one curved run of the right
 * length rather than thirty-two unbuildable offcuts. The distinction is the turn at
 * each vertex: a gentle, consistent turn is a curve, a sharp one is a corner.
 */
export function generatePerimeter(params: PerimeterParams): Member[] {
  const { layer, region, plane, zoneId, issues, pack } = params;
  const out: Member[] = [];
  const fixingCentres = layer.fixingCentres;
  const firstFromCorner = layer.firstFixingFromCorner;

  if (fixingCentres === null || firstFromCorner === null) {
    // The outline could be drawn from the boundary alone, but a run with no fixing
    // schedule is not buildable documentation, and drawing it would break the rule
    // the packs state: a layer whose required figures are blank is reported, not
    // generated.
    issues.error(
      'PERIMETER_FIXINGS_NOT_ENTERED',
      `${layer.id}: fixing centres have not been entered, so no perimeter trim was generated`,
      { zoneId, ruleId: `layers.${layer.id}.${fixingCentres === null ? 'fixingCentres' : 'firstFixingFromCorner'}` },
    );
    return [];
  }

  region.forEach((poly, polyIndex) => {
    const rings = layer.followHoles ? allRings(poly) : [poly.outer];
    rings.forEach((ring, ringWithinPoly) => {
      const ringIndex = polyIndex * 100 + ringWithinPoly;
      mergeRuns(ring).forEach((run, edgeIndex) => {
        if (run.length < EPS) return;
        const id = perimeterMemberId(zoneId, layer.id, ringIndex, edgeIndex);
        const fixings: FixingSpec[] = distributeAlong(run.length, fixingCentres, firstFromCorner).map((d) => {
          const at = pointAlongPolyline(run.points, d);
          return {
            type: layer.fixings.type,
            substrate: layer.fixings.substrate,
            count: layer.fixings.countPerConnection ?? 1,
            productCode: layer.fixings.productCode,
            at: { x: quantise(at.x), y: quantise(at.y), z: quantise(planeZ(plane, at)) },
          };
        });

        const member = makeMember({
          id,
          layer,
          product: params.product,
          segment: { a: run.a, b: run.b },
          plane,
          zoneId,
          fixings,
          provenance: provenance({
            pack,
            ruleId: `layers.${layer.id}`,
            reason: run.curved
              ? `${Math.round(run.length)}mm curved run around ${ringWithinPoly === 0 ? 'the zone boundary' : 'an opening'}, turning ${Math.round(run.turn)} degrees over ${run.points.length - 1} chords; set out to the true arc, fixed at ${fixingCentres}mm centres`
              : `${Math.round(run.length)}mm run along the ${ringWithinPoly === 0 ? 'zone boundary' : 'edge of an opening'}, fixed at ${fixingCentres}mm centres, ${layer.cornerTreatment} at both corners`,
            spacingUsed: fixingCentres,
          }),
        });

        out.push(
          run.curved
            ? {
                ...member,
                // The chord between the ends is meaningless for a curve; the cut
                // length is the length along it.
                length: run.length,
                planLength: run.length,
                path: run.points.map((p): Vec3 => ({ x: quantise(p.x), y: quantise(p.y), z: quantise(planeZ(plane, p)) })),
              }
            : member,
        );
      });
    });
  });

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const MAX_CURVE_TURN_PER_VERTEX = 15;

/**
 * Group a ring's edges into runs.
 *
 * A vertex ends the current run when the direction changes by more than
 * `maxTurnPerVertex`, or when it turns back the other way - that is a corner. Anything
 * gentler and consistent is a curve, and stays in the same run.
 */
export function mergeRuns(ring: Ring, maxTurnPerVertex = MAX_CURVE_TURN_PER_VERTEX): TrimRun[] {
  const n = ring.length;
  if (n < 2) return [];
  const limit = (maxTurnPerVertex * Math.PI) / 180;

  const points: Vec2[] = [];
  const runs: TrimRun[] = [];
  let turn = 0;
  let turnSign = 0;

  const flush = (): void => {
    if (points.length < 2) return;
    let length = 0;
    for (let i = 1; i < points.length; i++) length += dist(points[i - 1]!, points[i]!);
    const degrees = quantise((Math.abs(turn) * 180) / Math.PI);
    runs.push({
      a: points[0]!,
      b: points[points.length - 1]!,
      points: [...points],
      length: quantise(length),
      curved: degrees > 1 && points.length > 2,
      turn: degrees,
    });
    points.length = 0;
    turn = 0;
    turnSign = 0;
  };

  points.push(ring[0]!);
  for (let i = 0; i < n; i++) {
    const cur = ring[i]!;
    const next = ring[(i + 1) % n]!;
    const after = ring[(i + 2) % n]!;
    if (dist(cur, next) < EPS) continue;
    points.push(next);

    if (i === n - 1) break;
    const d1 = normalise(sub(next, cur));
    const d2 = dist(next, after) < EPS ? d1 : normalise(sub(after, next));
    const signed = Math.atan2(cross(d1, d2), d1.x * d2.x + d1.y * d2.y);
    const sign = Math.sign(signed);
    const reversed = turnSign !== 0 && sign !== 0 && sign !== turnSign;
    if (Math.abs(signed) > limit || reversed) {
      const carry = next;
      flush();
      points.push(carry);
    } else if (sign !== 0) {
      turn += signed;
      turnSign = sign;
    }
  }
  flush();

  // The ring is closed, so a run that ended at the start vertex joins the first run.
  if (runs.length > 1) {
    const first = runs[0]!;
    const last = runs[runs.length - 1]!;
    if (dist(last.b, first.a) < EPS && last.curved === first.curved && (first.curved || collinear(last, first))) {
      const merged: TrimRun = {
        a: last.a,
        b: first.b,
        points: [...last.points, ...first.points.slice(1)],
        length: quantise(last.length + first.length),
        curved: first.curved || last.curved,
        turn: quantise(first.turn + last.turn),
      };
      return [merged, ...runs.slice(1, -1)];
    }
  }
  return runs;
}

function collinear(a: TrimRun, b: TrimRun): boolean {
  const d1 = normalise(sub(a.b, a.a));
  const d2 = normalise(sub(b.b, b.a));
  return Math.abs(cross(d1, d2)) < 1e-6;
}

/** A point a given distance along a polyline. */
export function pointAlongPolyline(points: readonly Vec2[], distance: number): Vec2 {
  let remaining = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = dist(a, b);
    if (remaining <= seg || i === points.length - 1) {
      const t = seg < EPS ? 0 : Math.min(1, Math.max(0, remaining / seg));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= seg;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

/** Plan bearing of a wall run, in degrees, for the drawing. */
export const runBearing = (run: { a: Vec2; b: Vec2 }): number =>
  quantise(((angleOf(sub(run.b, run.a)) * 180) / Math.PI + 360) % 360);
