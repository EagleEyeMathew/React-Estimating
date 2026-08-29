import {
  angleOf,
  balancedOffset,
  dot,
  fromAngle,
  longestEdge,
  multiPolygonBBox,
  normalise,
  perp,
  principalAxis,
  projectRange,
  quantise,
  scale,
  sub,
  type MultiPolygon,
  type Ring,
  type Vec2,
} from '@ceiling/geometry';
import type { DirectionSpec, OriginSpec } from '../project.js';

export interface DirectionResult {
  readonly direction: Vec2;
  readonly reason: string;
}

/**
 * Step 2. Which way the primary members run.
 *
 * Nothing here snaps to the world axes. A room with a wall at 7 degrees gets a setout
 * at 7 degrees, because a setout that quietly squares itself up produces members that
 * do not match the walls they are meant to follow.
 */
export function resolveDirection(spec: DirectionSpec, boundary: Ring, region: MultiPolygon): DirectionResult {
  switch (spec.kind) {
    case 'vector':
      return { direction: normalise(spec.vector), reason: 'set by the user as a direction vector' };
    case 'angle':
      return {
        direction: fromAngle((spec.degrees * Math.PI) / 180),
        reason: `set by the user to ${spec.degrees} degrees`,
      };
    case 'principal-axis': {
      const axis = principalAxis(boundary);
      return {
        direction: axis,
        reason: `principal axis of the zone, ${degrees(axis)} degrees`,
      };
    }
    case 'longest-edge':
    default: {
      const e = longestEdge(boundary);
      const dir = normalise(sub(e.b, e.a));
      return {
        direction: dir,
        reason: `parallel to the longest wall (${Math.round(e.length)}mm, ${degrees(dir)} degrees)`,
      };
    }
  }
}

const degrees = (v: Vec2): number => quantise(((angleOf(v) * 180) / Math.PI + 360) % 180);

export interface OriginResult {
  readonly origin: Vec2;
  readonly reason: string;
}

/** Step 3. Where the setout lattice is anchored, and therefore how the edge cuts fall. */
export function resolveOrigin(spec: OriginSpec, region: MultiPolygon, boundary: Ring): OriginResult {
  switch (spec.kind) {
    case 'point':
      return { origin: spec.point, reason: 'set by the user' };
    case 'datum-corner': {
      const corner = datumCorner(boundary);
      return { origin: corner, reason: `datum corner at ${Math.round(corner.x)}, ${Math.round(corner.y)}` };
    }
    case 'balanced':
    default: {
      const box = multiPolygonBBox(region);
      return {
        origin: { x: quantise((box.minX + box.maxX) / 2), y: quantise((box.minY + box.maxY) / 2) },
        reason: 'centred on the zone so opposite edge cuts match',
      };
    }
  }
}

/** The boundary vertex nearest the world origin, resolved deterministically. */
export function datumCorner(boundary: Ring): Vec2 {
  let best = boundary[0]!;
  for (const p of boundary) {
    if (p.x < best.x - 1e-9 || (Math.abs(p.x - best.x) <= 1e-9 && p.y < best.y - 1e-9)) best = p;
  }
  return best;
}

/**
 * Where a layer's lattice sits, across the direction its members run.
 *
 * In balanced mode the lattice is centred on the zone so the two edge margins match,
 * which is what stops a job coming out with a full tile one side and a sliver the
 * other. In datum mode every layer is anchored on the one point the user nominated,
 * so the setout can be dimensioned from a known corner on site.
 */
export function layerLatticeOrigin(
  region: MultiPolygon,
  direction: Vec2,
  spacing: number,
  originSpec: OriginSpec,
  datum: Vec2,
): Vec2 {
  const u = normalise(direction);
  const n = perp(u);
  if (originSpec.kind !== 'balanced') {
    return datum;
  }
  const across = projectRange(region, n);
  const along = projectRange(region, u);
  const start = balancedOffset(across, spacing);
  return {
    x: quantise(n.x * start + u.x * along.min),
    y: quantise(n.y * start + u.y * along.min),
  };
}

/** Shift a lattice origin by `delta` across the member direction. */
export function shiftAcross(origin: Vec2, direction: Vec2, delta: number): Vec2 {
  const n = perp(normalise(direction));
  const moved = scale(n, delta);
  return { x: quantise(origin.x + moved.x), y: quantise(origin.y + moved.y) };
}

/** Perpendicular offset of a point from a lattice origin, along the across axis. */
export function acrossOf(p: Vec2, origin: Vec2, direction: Vec2): number {
  const n = perp(normalise(direction));
  return dot(sub(p, origin), n);
}
