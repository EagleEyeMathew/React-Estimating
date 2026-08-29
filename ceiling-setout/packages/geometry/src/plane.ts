import type { Segment, Vec2, Vec3 } from './types.js';
import { EPS, quantise } from './num.js';
import { dist, normalise } from './vec.js';

/**
 * A ceiling or structure plane, expressed as a level plus a gradient.
 *
 * Everything is generated in plan and then projected onto a plane. Generating
 * directly in 3D would mean every clipping and spacing routine had to be
 * rake-aware; projecting afterwards keeps all of that 2D and testable, and true
 * lengths and drops fall out of the projection.
 */
export interface Plane {
  /** Level of the plane at `origin`, mm. */
  readonly z: number;
  /** Plan point the level is measured at. */
  readonly origin: Vec2;
  /** Gradient: rise per unit run in x and y. Both zero for a horizontal plane. */
  readonly gradient: Vec2;
}

export const horizontalPlane = (z: number): Plane => ({ z, origin: { x: 0, y: 0 }, gradient: { x: 0, y: 0 } });

/**
 * A plane at `z` at `origin`, falling at `fall` (rise/run, e.g. 1/20) in the
 * direction `direction`.
 */
export function rakedPlane(z: number, origin: Vec2, direction: Vec2, fall: number): Plane {
  const u = normalise(direction);
  return { z, origin, gradient: { x: u.x * fall, y: u.y * fall } };
}

export const isHorizontal = (p: Plane): boolean =>
  Math.abs(p.gradient.x) < EPS && Math.abs(p.gradient.y) < EPS;

export function planeZ(plane: Plane, p: Vec2): number {
  return quantise(plane.z + plane.gradient.x * (p.x - plane.origin.x) + plane.gradient.y * (p.y - plane.origin.y));
}

export function projectToPlane(p: Vec2, plane: Plane): Vec3 {
  return { x: quantise(p.x), y: quantise(p.y), z: planeZ(plane, p) };
}

/**
 * Factor by which a plan length becomes a true length for a member running along
 * `direction` on `plane`. 1 on a flat ceiling; on a 1:20 rake a member running
 * straight up the slope is ~0.125% longer.
 */
export function trueLengthFactor(plane: Plane, direction: Vec2): number {
  const u = normalise(direction);
  const slope = plane.gradient.x * u.x + plane.gradient.y * u.y;
  return Math.sqrt(1 + slope * slope);
}

/** True (on-plane) length of a plan segment. */
export function trueLength(seg: Segment, plane: Plane): number {
  const planLength = dist(seg.a, seg.b);
  if (planLength < EPS) return 0;
  const dz = planeZ(plane, seg.b) - planeZ(plane, seg.a);
  return quantise(Math.hypot(planLength, dz));
}

/** The maximum fall across a plan segment, useful for reporting rakes. */
export function fallAcross(seg: Segment, plane: Plane): number {
  return quantise(planeZ(plane, seg.b) - planeZ(plane, seg.a));
}

export const planeSlopeRatio = (plane: Plane): number =>
  Math.hypot(plane.gradient.x, plane.gradient.y);
