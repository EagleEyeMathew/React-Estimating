import {
  boundaryToRing,
  circle,
  horizontalPlane,
  multiPolygonArea,
  normalisePolygon,
  rakedPlane,
  validatePolygon,
  workableRegion,
  type MultiPolygon,
  type Plane,
  type Ring,
  type Vec2,
} from '@ceiling/geometry';
import type { Penetration, PenetrationShape, PlaneSpec, Project, Structure, Zone } from '../project.js';
import type { IssueLog } from '../issues.js';

export interface ResolvedZone {
  readonly zone: Zone;
  /** Boundary less holes. The ceiling area, before openings are cut. */
  readonly region: MultiPolygon;
  readonly plane: Plane;
  readonly structure: Structure;
  readonly structurePlane: Plane;
  readonly boundaryRing: Ring;
}

export function toPlane(spec: PlaneSpec): Plane {
  return spec.kind === 'horizontal'
    ? horizontalPlane(spec.level)
    : rakedPlane(spec.level, spec.origin, spec.direction, spec.fall);
}

/** Step 1. Turn the stored zone into the geometry the rest of the pipeline works on. */
export function resolveZone(project: Project, zone: Zone, issues: IssueLog): ResolvedZone | null {
  const boundaryRing = boundaryToRing(zone.boundary);
  const problems = validatePolygon({ outer: boundaryRing, holes: zone.holes });
  for (const p of problems) {
    issues.error('BOUNDARY_INVALID', `${zone.name}: ${p.message}`, { zoneId: zone.id });
  }
  if (problems.length > 0) return null;

  const region = workableRegion(boundaryRing, zone.holes);
  if (multiPolygonArea(region) <= 0) {
    issues.error('ZONE_EMPTY', `${zone.name}: the holes leave no ceiling area`, { zoneId: zone.id });
    return null;
  }

  const structure = project.structures.find((s) => s.id === zone.structureId);
  if (!structure) {
    issues.error('STRUCTURE_MISSING', `${zone.name}: structure "${zone.structureId}" is not in the project`, {
      zoneId: zone.id,
    });
    return null;
  }

  const plane = toPlane(zone.plane);
  const structurePlane = toPlane(structure.plane);

  return { zone, region, plane, structure, structurePlane, boundaryRing };
}

/** The plan outline of a penetration, as a ring. */
export function penetrationRing(shape: PenetrationShape, arcSegments = 24): Ring {
  if (shape.kind === 'circle') return circle(shape.centre, shape.radius, arcSegments);
  const hw = shape.width / 2;
  const hh = shape.height / 2;
  const c = Math.cos(shape.rotation);
  const s = Math.sin(shape.rotation);
  const corner = (dx: number, dy: number): Vec2 => ({
    x: shape.centre.x + dx * c - dy * s,
    y: shape.centre.y + dx * s + dy * c,
  });
  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

export function penetrationArea(shape: PenetrationShape): number {
  return shape.kind === 'circle' ? Math.PI * shape.radius ** 2 : shape.width * shape.height;
}

/** The largest plan dimension of a penetration - what a "trim above width" rule tests. */
export function penetrationWidth(shape: PenetrationShape): number {
  return shape.kind === 'circle' ? shape.radius * 2 : Math.max(shape.width, shape.height);
}

export const penetrationCentre = (p: Penetration): Vec2 => p.shape.centre;

export function penetrationPolygon(p: Penetration): MultiPolygon {
  return [normalisePolygon({ outer: penetrationRing(p.shape), holes: [] })];
}
