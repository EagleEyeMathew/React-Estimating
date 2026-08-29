import {
  angleOf,
  planeZ,
  quantise,
  round,
  sub,
  trueLength,
  type Plane,
  type Segment,
  type Vec2,
  type Vec3,
} from '@ceiling/geometry';
import type { Layer, Product } from '@ceiling/rules';
import type { FixingSpec, Member, Provenance } from './types.js';

export interface MemberInput {
  readonly id: string;
  readonly layer: Layer;
  readonly product: Product | null;
  readonly segment: Segment;
  readonly plane: Plane;
  readonly zoneId: string;
  readonly provenance: Provenance;
  readonly connectsTo?: readonly string[];
  readonly fixings?: readonly FixingSpec[];
  /** Overrides the layer's own height above FCL, for members that sit elsewhere. */
  readonly heightAboveFcl?: number;
}

/**
 * Build a member from a plan segment by projecting it onto the ceiling plane.
 *
 * Everything is generated in plan and projected here, which is why a rake needs no
 * special cases anywhere upstream: the true cut length and the levels at each end
 * fall out of the projection.
 */
export function makeMember(input: MemberInput): Member {
  const { segment, plane, layer } = input;
  const height = input.heightAboveFcl ?? layer.heightAboveFcl ?? 0;
  const lift = (p: Vec2): Vec3 => ({ x: quantise(p.x), y: quantise(p.y), z: quantise(planeZ(plane, p) + height) });
  const d = sub(segment.b, segment.a);
  const planLength = quantise(Math.hypot(d.x, d.y));
  return {
    id: input.id,
    type: layer.memberType,
    layerId: layer.id,
    productCode: input.product?.code ?? layer.product ?? null,
    start: lift(segment.a),
    end: lift(segment.b),
    length: trueLength(segment, plane),
    planLength,
    // Radians, rounded fine enough to stay reproducible without pretending a
    // millimetre grid means anything for an angle.
    rotation: round(angleOf(d), 9),
    fixings: input.fixings ?? [],
    connectsTo: input.connectsTo ?? [],
    zoneId: input.zoneId,
    provenance: input.provenance,
  };
}

/** A point member - a hanger, clip or bracket - as a zero-plan-length member. */
export function makePointMember(
  input: Omit<MemberInput, 'segment'> & {
    readonly at: Vec2;
    readonly top: number;
    readonly bottom: number;
    /**
     * Plan rotation, in radians. A clip straddles the member it sits on, so it has to
     * turn with it: on a skew setout an axis-aligned clip would sit across its own
     * channel.
     */
    readonly rotation?: number;
  },
): Member {
  const { at, top, bottom } = input;
  const start: Vec3 = { x: quantise(at.x), y: quantise(at.y), z: quantise(bottom) };
  const end: Vec3 = { x: quantise(at.x), y: quantise(at.y), z: quantise(top) };
  return {
    id: input.id,
    type: input.layer.memberType,
    layerId: input.layer.id,
    productCode: input.product?.code ?? input.layer.product ?? null,
    start,
    end,
    length: quantise(Math.abs(top - bottom)),
    planLength: 0,
    rotation: round(input.rotation ?? 0, 9),
    fixings: input.fixings ?? [],
    connectsTo: input.connectsTo ?? [],
    zoneId: input.zoneId,
    provenance: input.provenance,
  };
}

export const planSegment = (m: Member): Segment => ({
  a: { x: m.start.x, y: m.start.y },
  b: { x: m.end.x, y: m.end.y },
});

export const isPointMember = (m: Member): boolean => m.planLength === 0;
