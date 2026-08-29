import {
  add,
  multiPolygonBBox,
  normalise,
  perp,
  planeZ,
  pointInMultiPolygon,
  quantise,
  scale,
  type MultiPolygon,
  type Plane,
  type Vec2,
} from '@ceiling/geometry';
import type { BraceLayer, Product, RulePack } from '@ceiling/rules';
import { braceMemberId } from '../identity.js';
import { makeMember } from '../member.js';
import type { IssueLog } from '../issues.js';
import { provenance } from '../provenance.js';
import type { Member } from '../types.js';

export interface BracingParams {
  readonly pack: RulePack;
  readonly layer: BraceLayer;
  readonly product: Product | null;
  readonly region: MultiPolygon;
  readonly plane: Plane;
  readonly structurePlane: Plane;
  readonly direction: Vec2;
  readonly systemDepth: number | null;
  readonly zoneId: string;
  readonly issues: IssueLog;
}

/**
 * Step 10. Lateral restraint on a grid, where the drop is long enough to need it.
 *
 * Off by default in every shipped pack: whether a ceiling needs restraint, and to
 * what, is a question for the project's engineer, not for a spacing table. When it is
 * switched on the geometry is generated so it can be drawn and counted, and every
 * brace says in its provenance that its adequacy has not been assessed here.
 */
export function generateBracing(params: BracingParams): Member[] {
  const { layer, region, plane, structurePlane, zoneId, issues, pack } = params;
  const grid = layer.gridSpacing;
  const maxFromWall = layer.maxFromWall;
  if (grid === null) {
    issues.warn('BRACE_SPACING_NOT_ENTERED', `${layer.id}: no brace grid spacing entered, so no braces were placed`, {
      zoneId,
      ruleId: `layers.${layer.id}.gridSpacing`,
    });
    return [];
  }

  const u = normalise(params.direction);
  const n = perp(u);
  const box = multiPolygonBBox(region);
  const inset = maxFromWall ?? 0;
  const angle = ((layer.angleFromVertical ?? 45) * Math.PI) / 180;
  const minDrop = layer.minDropToRequire;
  const out: Member[] = [];

  const startX = box.minX + inset;
  const startY = box.minY + inset;
  const countX = Math.max(0, Math.floor((box.maxX - inset - startX) / grid));
  const countY = Math.max(0, Math.floor((box.maxY - inset - startY) / grid));

  for (let i = 0; i <= countX; i++) {
    for (let j = 0; j <= countY; j++) {
      const at: Vec2 = { x: quantise(startX + i * grid), y: quantise(startY + j * grid) };
      if (pointInMultiPolygon(at, region) !== 'inside') continue;
      const bottom = planeZ(plane, at) + (params.systemDepth ?? 0);
      const top = planeZ(structurePlane, at);
      const drop = top - bottom;
      if (minDrop !== null && drop < minDrop) continue;
      // A brace leans back from vertical by the pack's angle, in the setout direction.
      const reach = Math.tan(angle) * drop;
      const head = add(at, scale(i % 2 === 0 ? u : n, reach));
      out.push(
        makeMember({
          id: braceMemberId(zoneId, layer.id, i, j),
          layer,
          product: params.product,
          segment: { a: at, b: head },
          plane,
          zoneId,
          heightAboveFcl: 0,
          provenance: provenance({
            pack,
            ruleId: `layers.${layer.id}.gridSpacing`,
            reason: `brace on the ${grid}mm grid at a ${Math.round(drop)}mm drop, ${Math.round((angle * 180) / Math.PI)} degrees from vertical; restraint adequacy is not assessed by this app`,
            spacingUsed: grid,
          }),
        }),
      );
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
