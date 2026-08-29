import type { MultiPolygon, Segment, Vec2 } from './types.js';
import { EPS, RESOLUTION, quantise } from './num.js';
import { add, dot, normalise, perp, scale, sub, dist } from './vec.js';
import { clipOpenPaths } from './clipper.js';
import { outset } from './offset.js';
import { nearestBoundaryPoint } from './predicates.js';
import { allRings } from './polygon.js';

/** Extent of a region measured along a direction. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

export function projectRange(mp: MultiPolygon, dir: Vec2): Range {
  const u = normalise(dir);
  let min = Infinity;
  let max = -Infinity;
  for (const poly of mp) {
    for (const ring of allRings(poly)) {
      for (const p of ring) {
        const t = dot(p, u);
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
  }
  if (!Number.isFinite(min)) throw new RangeError('cannot project an empty region');
  return { min, max };
}

export interface ArraySegment {
  /**
   * Signed lattice index of the line this piece came from, counted from the origin
   * line. Stable under changes elsewhere in the zone, which is what lets member
   * identities - and therefore user overrides - survive a regeneration.
   */
  readonly lineIndex: number;
  /** Perpendicular distance of the line from the origin line (signed, mm). */
  readonly offset: number;
  /** Index of this piece within its line, ordered along the member direction. */
  readonly segmentIndex: number;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly length: number;
}

export interface LineArrayOptions {
  /** Region the members are clipped to. Already inset if a setback applies. */
  readonly region: MultiPolygon;
  /** Direction the members run in. Need not be axis-aligned or normalised. */
  readonly direction: Vec2;
  /** Perpendicular spacing between adjacent lines, mm. */
  readonly spacing: number;
  /** A point the lattice line with index 0 passes through. */
  readonly origin: Vec2;
  /** Pieces shorter than this are discarded rather than left as unusable offcuts. */
  readonly minSegmentLength?: number;
  /** Optional cap on how many lines may be generated - a guard against absurd spacings. */
  readonly maxLines?: number;
  /**
   * How far outside the region a line may still count as inside it, mm.
   *
   * Without this, a line falling exactly on a wall - which a setout origin on a datum
   * corner produces every time - is dropped by the clip as coincident rather than
   * interior, and the member the user asked for silently disappears. Defaults to one
   * resolution unit.
   */
  readonly boundaryTolerance?: number;
}

export interface LineArrayResult {
  readonly segments: readonly ArraySegment[];
  /** Pieces dropped for being shorter than `minSegmentLength`, kept so they can be reported. */
  readonly discarded: readonly ArraySegment[];
  readonly lineCount: number;
}

const DEFAULT_MAX_LINES = 5000;

/**
 * Generate a family of parallel lines at a fixed spacing and clip them to the region.
 *
 * Two properties matter and are both load-bearing for the rest of the app:
 *
 * 1. A line crossing a concave room, or crossing a hole, comes back as several
 *    disjoint pieces. Each becomes its own member. Nothing bridges a void.
 * 2. Line positions come from a signed lattice anchored on `origin`, not from
 *    iteration order. Widening the zone on one side does not renumber the members on
 *    the other side.
 */
export function lineArray(opts: LineArrayOptions): LineArrayResult {
  const { region, spacing, origin } = opts;
  if (!(spacing > 0)) throw new RangeError(`spacing must be > 0, got ${spacing}`);
  if (region.length === 0) return { segments: [], discarded: [], lineCount: 0 };

  const u = normalise(opts.direction);
  const n = perp(u);
  const minSegmentLength = opts.minSegmentLength ?? 0;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;

  const across = projectRange(region, n);
  const along = projectRange(region, u);
  const originAcross = dot(origin, n);

  // Lattice indices that can possibly intersect the region.
  const kMin = Math.ceil((across.min - originAcross) / spacing - 1e-9);
  const kMax = Math.floor((across.max - originAcross) / spacing + 1e-9);
  const lineCount = Math.max(0, kMax - kMin + 1);
  if (lineCount > maxLines) {
    throw new RangeError(
      `line array would produce ${lineCount} lines at ${spacing}mm spacing (limit ${maxLines}); check the spacing value`,
    );
  }

  // Extend each line well past the region so the clip, not the extent, defines the ends.
  const pad = Math.max(1000, (along.max - along.min) * 0.05);
  const t0 = along.min - pad;
  const t1 = along.max + pad;

  const segments: ArraySegment[] = [];
  const discarded: ArraySegment[] = [];

  // A line lying exactly along a wall is coincident with the clip boundary rather
  // than interior to it, so the exact clip discards it. That case is not exotic - a
  // setout origin on a datum corner produces one every time - so those lines are
  // retried against a hair-outset region and their endpoints snapped back onto the
  // true boundary. The retry is confined to lines the exact clip rejected outright,
  // which keeps every ordinary member exact rather than tolerance-inflated.
  const boundaryTolerance = opts.boundaryTolerance ?? RESOLUTION;
  let grownRegion: MultiPolygon | null = null;
  const snapTolerance = Math.max(10 * boundaryTolerance, EPS);

  for (let k = kMin; k <= kMax; k++) {
    const offset = k * spacing;
    // Rebuild the line from the lattice each time rather than stepping, so no
    // accumulated error creeps across a wide room.
    const base = add(origin, scale(n, offset));
    for (const seg of clipLine(base, u, t0, t1, region, k, offset, boundaryTolerance, snapTolerance, () => {
      grownRegion ??= outset(region, boundaryTolerance);
      return grownRegion;
    })) {
      if (seg.length + EPS < minSegmentLength) discarded.push(seg);
      else segments.push(seg);
    }
  }

  return { segments, discarded, lineCount };
}

function clipLine(
  base: Vec2,
  u: Vec2,
  t0: number,
  t1: number,
  region: MultiPolygon,
  lineIndex: number,
  offset: number,
  boundaryTolerance: number,
  snapTolerance: number,
  grown: () => MultiPolygon,
): ArraySegment[] {
  const p0 = add(base, scale(u, t0 - dot(base, u)));
  const p1 = add(base, scale(u, t1 - dot(base, u)));
  let pieces = clipOpenPaths([[p0, p1]], region);

  if (pieces.length === 0 && boundaryTolerance > 0) {
    pieces = clipOpenPaths([[p0, p1]], grown()).map((piece) =>
      piece.map((pt) => {
        const near = nearestBoundaryPoint(pt, region);
        return near.point && near.distance <= snapTolerance ? near.point : pt;
      }),
    );
  }

  return pieces
    .filter((p) => p.length >= 2)
    .map((p) => {
      let a = p[0]!;
      let b = p[p.length - 1]!;
      // Order each piece along the member direction so start/end are predictable.
      if (dot(a, u) > dot(b, u)) [a, b] = [b, a];
      return { a: { x: quantise(a.x), y: quantise(a.y) }, b: { x: quantise(b.x), y: quantise(b.y) } };
    })
    .filter((s) => dist(s.a, s.b) > EPS)
    .sort((s1, s2) => dot(s1.a, u) - dot(s2.a, u))
    .map((s, i) => ({
      lineIndex,
      offset: quantise(offset),
      segmentIndex: i,
      a: s.a,
      b: s.b,
      length: quantise(dist(s.a, s.b)),
    }));
}

/**
 * One line through a point, clipped to the region.
 *
 * The same clip as a line array, for the cases that need a single line rather than a
 * family: a member added to satisfy a perimeter setback answers one wall, and asking
 * for a whole array and discarding all but one line would clip a hundred lines to
 * throw away ninety-nine.
 */
export function singleLine(options: {
  readonly region: MultiPolygon;
  readonly direction: Vec2;
  readonly through: Vec2;
  readonly minSegmentLength?: number;
  readonly boundaryTolerance?: number;
}): { segments: ArraySegment[]; discarded: ArraySegment[] } {
  const { region, through } = options;
  if (region.length === 0) return { segments: [], discarded: [] };
  const u = normalise(options.direction);
  const n = perp(u);
  const minSegmentLength = options.minSegmentLength ?? 0;
  const boundaryTolerance = options.boundaryTolerance ?? RESOLUTION;
  const along = projectRange(region, u);
  const pad = Math.max(1000, (along.max - along.min) * 0.05);
  let grownRegion: MultiPolygon | null = null;

  const pieces = clipLine(
    through,
    u,
    along.min - pad,
    along.max + pad,
    region,
    0,
    quantise(dot(through, n)),
    boundaryTolerance,
    Math.max(10 * boundaryTolerance, EPS),
    () => {
      grownRegion ??= outset(region, boundaryTolerance);
      return grownRegion;
    },
  );

  const segments: ArraySegment[] = [];
  const discarded: ArraySegment[] = [];
  for (const seg of pieces) {
    if (seg.length + EPS < minSegmentLength) discarded.push(seg);
    else segments.push(seg);
  }
  return { segments, discarded };
}

/**
 * Origin offset that balances the two edge margins.
 *
 * With a fixed module (tile grids, exposed battens) the visible failure is a full
 * tile against one wall and a 90mm sliver against the other. Centring the lattice on
 * the region makes the two edge cuts equal, which is what a setter-out does by hand.
 */
export function balancedOffset(range: Range, spacing: number): number {
  if (!(spacing > 0)) throw new RangeError('spacing must be > 0');
  const width = range.max - range.min;
  const bays = Math.floor(width / spacing + 1e-9);
  const used = bays * spacing;
  const margin = (width - used) / 2;
  return quantise(range.min + margin);
}

/**
 * A lattice origin that centres the array across the region, perpendicular to
 * `direction`. `direction` is the direction the members run in.
 */
export function balancedOrigin(region: MultiPolygon, direction: Vec2, spacing: number): Vec2 {
  const u = normalise(direction);
  const n = perp(u);
  const across = projectRange(region, n);
  const along = projectRange(region, u);
  const acrossAt = balancedOffset(across, spacing);
  // Any point on the k=0 line will do; pick one near the start of the region so the
  // origin is a sensible thing to show the user as a setout datum.
  return {
    x: quantise(n.x * acrossAt + u.x * along.min),
    y: quantise(n.y * acrossAt + u.y * along.min),
  };
}

/**
 * Distribute points along a segment so that no gap exceeds `maxSpacing` and the two
 * end gaps do not exceed `firstFromEnd`. Returns positions measured from `a`.
 *
 * Both free ends are treated identically, including ends created by a hole rather
 * than by a wall - an unsupported end over a void is the same defect either way.
 */
export function distributeAlong(
  length: number,
  maxSpacing: number,
  firstFromEnd: number,
): number[] {
  if (!(maxSpacing > 0)) throw new RangeError('maxSpacing must be > 0');
  if (firstFromEnd < 0) throw new RangeError('firstFromEnd must be >= 0');
  if (length <= EPS) return [];
  // The end fixings are mandatory; the interior is divided evenly between them.
  const first = Math.min(firstFromEnd, length / 2);
  const last = length - first;
  const inner = last - first;
  if (inner <= EPS) return [quantise(length / 2)];
  const bays = Math.max(1, Math.ceil(inner / maxSpacing - 1e-9));
  const step = inner / bays;
  const out: number[] = [];
  for (let i = 0; i <= bays; i++) out.push(quantise(first + i * step));
  return out;
}

export function pointAt(seg: Segment, distanceFromA: number): Vec2 {
  const d = sub(seg.b, seg.a);
  const l = Math.hypot(d.x, d.y);
  if (l < EPS) return seg.a;
  const t = distanceFromA / l;
  return { x: quantise(seg.a.x + d.x * t), y: quantise(seg.a.y + d.y * t) };
}
