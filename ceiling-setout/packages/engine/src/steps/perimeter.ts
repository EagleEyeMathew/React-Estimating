import {
  EPS,
  allRings,
  angleOf,
  cross,
  dist,
  distributeAlong,
  normalise,
  quantise,
  sub,
  type MultiPolygon,
  type Plane,
  type Ring,
  type Vec2,
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

/**
 * Step 9. Wall angle or shadowline around the zone, as one run per wall.
 *
 * Runs are per wall rather than per tessellated edge, so a wall broken into segments
 * by the boolean operations upstream still schedules as one cut length. Collinear
 * edges are merged for the same reason: a curved wall approximated by forty chords is
 * forty pieces of trim on paper and one bent length in practice, and the schedule has
 * to say which.
 */
export function generatePerimeter(params: PerimeterParams): Member[] {
  const { layer, region, plane, zoneId, issues, pack } = params;
  const out: Member[] = [];
  const fixingCentres = layer.fixingCentres;
  const firstFromCorner = layer.firstFixingFromCorner;

  if (fixingCentres === null || firstFromCorner === null) {
    // The outline of the trim could be drawn from the boundary alone, but a run with
    // no fixing schedule is not a buildable piece of documentation, and drawing it
    // would break the rule the packs state: a layer whose required figures are blank
    // is reported, not generated.
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
      const runs = mergeCollinear(ring);
      runs.forEach((run, edgeIndex) => {
        const length = dist(run.a, run.b);
        if (length < EPS) return;
        const id = perimeterMemberId(zoneId, layer.id, ringIndex, edgeIndex);
        const fixings: FixingSpec[] = distributeAlong(length, fixingCentres, firstFromCorner).map((d) => {
          const t = d / length;
          const at = { x: run.a.x + (run.b.x - run.a.x) * t, y: run.a.y + (run.b.y - run.a.y) * t };
          return {
            type: layer.fixings.type,
            substrate: layer.fixings.substrate,
            count: layer.fixings.countPerConnection ?? 1,
            productCode: layer.fixings.productCode,
            at: { x: quantise(at.x), y: quantise(at.y), z: 0 },
          };
        });

        out.push(
          makeMember({
            id,
            layer,
            product: params.product,
            segment: run,
            plane,
            zoneId,
            fixings: fixings.map((f) => ({ ...f, at: { ...f.at, z: 0 } })),
            provenance: provenance({
              pack,
              ruleId: `layers.${layer.id}`,
              reason: `${Math.round(length)}mm run along the ${ringWithinPoly === 0 ? 'zone boundary' : 'edge of an opening'}, fixed at ${fixingCentres}mm centres, ${layer.cornerTreatment} at both corners`,
              spacingUsed: fixingCentres,
            }),
          }),
        );
      });
    });
  });

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Merge runs of collinear edges into single wall runs. */
export function mergeCollinear(ring: Ring, angleTolerance = 1e-4): { a: Vec2; b: Vec2 }[] {
  const n = ring.length;
  if (n < 2) return [];
  const runs: { a: Vec2; b: Vec2 }[] = [];
  let start = ring[0]!;
  for (let i = 0; i < n; i++) {
    const cur = ring[i]!;
    const next = ring[(i + 1) % n]!;
    const after = ring[(i + 2) % n]!;
    if (dist(cur, next) < EPS) continue;
    const d1 = normalise(sub(next, cur));
    const d2 = dist(next, after) < EPS ? d1 : normalise(sub(after, next));
    const turn = Math.abs(cross(d1, d2));
    if (turn > angleTolerance || i === n - 1) {
      runs.push({ a: start, b: next });
      start = next;
    }
  }
  return runs.filter((r) => dist(r.a, r.b) > EPS);
}

/** Plan bearing of a wall run, in degrees, for the drawing. */
export const runBearing = (run: { a: Vec2; b: Vec2 }): number =>
  quantise(((angleOf(sub(run.b, run.a)) * 180) / Math.PI + 360) % 360);
