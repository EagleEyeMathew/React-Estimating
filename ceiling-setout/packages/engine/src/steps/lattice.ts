import {
  balancedOffset,
  dot,
  normalise,
  perp,
  projectRange,
  quantise,
  type MultiPolygon,
  type Vec2,
} from '@ceiling/geometry';
import type { Penetration, OriginSpec } from '../project.js';
import { penetrationWidth } from './resolveZone.js';

/** Where a layer's members go: the spacing to use and the line the lattice starts on. */
export interface LatticePlan {
  /**
   * Exact, deliberately not snapped to the working resolution. A derived spacing
   * divides an odd width into equal bays, so it usually recurs; rounding it here and
   * then multiplying by nine bays leaves the last member a micron off the wall it is
   * supposed to be exactly the setback from. The member positions are quantised, the
   * spacing that generates them is not.
   */
  readonly spacing: number;
  readonly origin: Vec2;
  /** Distance from the wall to the first member, where a setback rule applied. */
  readonly firstFromWall: number | null;
  /** How many bays the zone was divided into. Null for a fixed module. */
  readonly bays: number | null;
  readonly reason: string;
  /** How far the setout moved to keep openings off the members, mm. */
  readonly nudged: number;
  /** Bays added beyond the minimum, to keep openings clear. Extra material. */
  readonly extraBays: number;
}

export interface LatticeInput {
  readonly region: MultiPolygon;
  readonly direction: Vec2;
  /** Maximum permitted spacing. Ignored when `module` is set. */
  readonly maxSpacing: number;
  /** Fixed visible module, if this layer has one. */
  readonly module: number | null;
  readonly maxFromWall: number | null;
  readonly originSpec: OriginSpec;
  readonly datum: Vec2;
  /** Openings that must not land on a member. */
  readonly penetrations: readonly Penetration[];
  readonly minClearOfMember: number;
}

/**
 * Choose the spacing and the lattice line for a layer.
 *
 * There are two kinds of layer and they need different answers.
 *
 * A layer with a fixed module - a tile grid, an exposed batten - is set out on that
 * module and centred, so the edge cuts match on opposite sides. The module is what the
 * ceiling looks like and cannot be adjusted to suit a setback.
 *
 * A layer with a free spacing is set out the way a setter-out does it: the first and
 * last members go at the setback distance off each wall, and what is left between them
 * is divided into equal bays no wider than the maximum. That gives 411mm bays rather
 * than 450mm bays plus an extra channel 40mm off the last one, which is what a lattice
 * at the maximum spacing plus a perimeter member produces - rule-compliant, and not
 * something anyone would build.
 */
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function planLattice(input: LatticeInput): LatticePlan {
  const u = normalise(input.direction);
  const n = perp(u);
  const across = projectRange(input.region, n);
  const along = projectRange(input.region, u);
  const width = across.max - across.min;

  const at = (offsetAcross: number): Vec2 => ({
    x: quantise(n.x * offsetAcross + u.x * along.min),
    y: quantise(n.y * offsetAcross + u.y * along.min),
  });

  // A fixed module is set out as a module and centred; it is not ours to adjust.
  if (input.module !== null) {
    if (input.originSpec.kind !== 'balanced') {
      return {
        spacing: input.module,
        origin: input.datum,
        firstFromWall: null,
        bays: null,
        reason: `set out at the ${input.module}mm module from the nominated datum`,
        nudged: 0,
        extraBays: 0,
      };
    }
    const start = balancedOffset(across, input.module);
    return {
      spacing: input.module,
      origin: at(start),
      firstFromWall: quantise(start - across.min),
      bays: Math.floor(width / input.module + 1e-9),
      reason: `set out at the ${input.module}mm module, centred on the zone so the edge cuts match`,
      nudged: 0,
      extraBays: 0,
    };
  }

  // Anchored on a datum: the user wants an exact setout, so no derived spacing.
  if (input.originSpec.kind !== 'balanced') {
    return {
      spacing: input.maxSpacing,
      origin: input.datum,
      firstFromWall: null,
      bays: null,
      reason: `spaced at ${input.maxSpacing}mm from the nominated datum`,
      nudged: 0,
      extraBays: 0,
    };
  }

  const setback = input.maxFromWall;
  if (setback === null) {
    // No setback rule to work to, so fall back to a centred lattice at the maximum.
    const start = balancedOffset(across, input.maxSpacing);
    return {
      spacing: input.maxSpacing,
      origin: at(start),
      firstFromWall: quantise(start - across.min),
      bays: Math.floor(width / input.maxSpacing + 1e-9),
      reason: `spaced at ${input.maxSpacing}mm, centred on the zone; no maximum distance from wall has been entered`,
      nudged: 0,
      extraBays: 0,
    };
  }

  const solve = (first: number, extraBays: number): { spacing: number; start: number; bays: number; extraBays: number } => {
    const clamped = Math.min(first, width / 2);
    const inner = width - 2 * clamped;
    if (inner <= 1e-6) return { spacing: input.maxSpacing, start: across.min + width / 2, bays: 0, extraBays };
    const bays = Math.max(1, Math.ceil(inner / input.maxSpacing - 1e-9)) + extraBays;
    return { spacing: inner / bays, start: quantise(across.min + clamped), bays, extraBays };
  };

  // Openings that must stay off a member leave two things to choose: how far off the
  // wall the first member sits, anywhere from hard against it up to the setback, and
  // whether to add a bay. Every combination satisfies both rules - an extra bay only
  // ever tightens the spacing - but an extra bay is extra material, so it is only
  // reached for when moving the first member cannot clear the openings on its own.
  const targets = input.penetrations.map((p) => ({
    across: dot(p.shape.centre, n),
    reach: penetrationWidth(p.shape) / 2 + input.minClearOfMember,
  }));

  const conflicts = (plan: { spacing: number; start: number; bays: number }): number =>
    targets.filter((t) => {
      const rel = t.across - plan.start;
      if (rel < -t.reach || rel > plan.bays * plan.spacing + t.reach) return false;
      const nearest = Math.abs(rel - Math.round(rel / plan.spacing) * plan.spacing);
      return nearest < t.reach - 1e-6;
    }).length;

  const preferred = solve(setback, 0);
  const baseline = conflicts(preferred);
  if (baseline === 0 || targets.length === 0) {
    return {
      spacing: preferred.spacing,
      origin: at(preferred.start),
      firstFromWall: quantise(preferred.start - across.min),
      bays: preferred.bays,
      reason: `${preferred.bays} equal bays of ${round3(preferred.spacing)}mm between members set ${Math.round(preferred.start - across.min)}mm off each wall; no bay over the ${input.maxSpacing}mm maximum`,
      nudged: 0,
      extraBays: 0,
    };
  }

  const steps = 60;
  let best = preferred;
  let bestConflicts = baseline;
  let bestFirst = setback;
  search: for (const extra of [0, 1, 2]) {
    for (let i = 0; i <= steps; i++) {
      // Walk in from the setback towards the wall, so the smallest departure from the
      // standard setout wins.
      const first = (setback * (steps - i)) / steps;
      const plan = solve(first, extra);
      const c = conflicts(plan);
      if (c < bestConflicts) {
        bestConflicts = c;
        best = plan;
        bestFirst = first;
        if (c === 0) break search;
      }
    }
  }

  const moved = quantise(Math.abs(setback - bestFirst));
  const adjustments: string[] = [];
  if (moved > 0) adjustments.push(`${Math.round(moved)}mm in from the ${setback}mm setback`);
  if (best.extraBays > 0) {
    adjustments.push(`${best.extraBays} extra bay(s) beyond the minimum the spacing rule needs`);
  }
  const why =
    adjustments.length > 0
      ? ` - ${adjustments.join(' and ')}, to keep openings clear of the members`
      : '';
  return {
    spacing: best.spacing,
    origin: at(best.start),
    firstFromWall: quantise(best.start - across.min),
    bays: best.bays,
    reason: `${best.bays} equal bays of ${round3(best.spacing)}mm between members set ${Math.round(best.start - across.min)}mm off each wall${why}; no bay over the ${input.maxSpacing}mm maximum`,
    nudged: moved,
    extraBays: best.extraBays,
  };
}
