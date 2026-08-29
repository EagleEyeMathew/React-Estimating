import {
  add,
  angleOf,
  dist,
  dot,
  normalise,
  perp,
  projectRange,
  quantise,
  scale,
  sub,
  type MultiPolygon,
  type Vec2,
} from '@ceiling/geometry';
import type { Member, Zone, ZoneResult } from '@ceiling/engine';
import { penetrationCentre, penetrationWidth } from '@ceiling/engine';

export type DimensionKind = 'first-from-wall' | 'running' | 'overall' | 'penetration' | 'radial' | 'angular';

/**
 * A dimension as the drawing needs it: two measured points, the direction it is
 * measured along, and where the dimension line sits.
 *
 * Dimensions are generated from the setout, not measured off the drawing afterwards.
 * That way what is dimensioned is exactly what the engine decided, and the number on
 * the paper cannot drift from the number in the model.
 */
export interface Dimension {
  readonly id: string;
  readonly kind: DimensionKind;
  readonly a: Vec2;
  readonly b: Vec2;
  /** Unit vector the dimension is measured along. */
  readonly direction: Vec2;
  /**
   * Signed perpendicular offset of the dimension line from the measured points, mm.
   * Always signed so the line lands outside the zone rather than across it.
   */
  readonly offset: number;
  readonly value: number;
  readonly text: string;
  /** What the dimension is for, in words, for the reader and for the issues report. */
  readonly note: string;
  readonly zoneId: string;
}

export interface DimensionOptions {
  /** How far off the zone the first dimension line sits, mm. */
  readonly baseOffset?: number;
  /** Gap between successive dimension lines, mm. */
  readonly lineGap?: number;
  /** Layers to run a running chain for. Defaults to every line-array layer present. */
  readonly layers?: readonly string[];
}

const DEFAULTS = { baseOffset: 400, lineGap: 300 };

/**
 * The setout dimensions for a zone: first member from each wall, a running chain
 * through every member, the overall sizes, and the centre of every penetration.
 */
export function dimensionZone(zone: Zone, result: ZoneResult, options: DimensionOptions = {}): Dimension[] {
  const baseOffset = options.baseOffset ?? DEFAULTS.baseOffset;
  const lineGap = options.lineGap ?? DEFAULTS.lineGap;
  const u = normalise(result.setout.direction);
  const n = perp(u);
  const out: Dimension[] = [];

  const layers = options.layers ?? layersPresent(result);
  const along = projectRange(result.region, u);
  const across = projectRange(result.region, n);
  // Dimension lines belong outside the plan. Which side that is depends on the zone,
  // not on the handedness of the axis, so every offset is signed away from the middle
  // of the region rather than being pushed blindly along the perpendicular.
  const middle: Vec2 = {
    x: (u.x * (along.min + along.max)) / 2 + (n.x * (across.min + across.max)) / 2,
    y: (u.y * (along.min + along.max)) / 2 + (n.y * (across.min + across.max)) / 2,
  };
  const outward = (base: Vec2, direction: Vec2, magnitude: number): number => {
    const away = dot(sub(base, middle), perp(normalise(direction)));
    return away >= 0 ? magnitude : -magnitude;
  };

  let level = 0;
  for (const layerId of layers) {
    const members = result.members.filter((m) => m.layerId === layerId && m.planLength > 0);
    if (members.length === 0) continue;
    // Members of a layer all run one way; the chain measures across that way. Both the
    // member positions and the extent of the zone have to be measured in that same
    // frame - measuring one along the setout axis and the other across it produces a
    // chain that reads as the width of the room.
    const axis = isAcross(members[0]!, u) ? u : n;
    const chainAxis = perp(axis);
    const range = projectRange(result.region, chainAxis);
    const alongStart = projectRange(result.region, axis).min;
    const offsets = uniqueOffsets(members, chainAxis);
    if (offsets.length === 0) continue;

    const offset = baseOffset + level * lineGap;
    const stops = [range.min, ...offsets, range.max];

    // First member from the wall at each end, which is the dimension a setter-out
    // works to and the one the setback rule is about.
    out.push(
      makeDimension(
        `${result.zoneId}:${layerId}:first`,
        'first-from-wall',
        pointAt(chainAxis, axis, range.min, alongStart),
        pointAt(chainAxis, axis, offsets[0]!, alongStart),
        chainAxis,
        outward(pointAt(chainAxis, axis, range.min, alongStart), chainAxis, offset),
        `first ${layerId} from the wall`,
        result.zoneId,
      ),
    );
    out.push(
      makeDimension(
        `${result.zoneId}:${layerId}:last`,
        'first-from-wall',
        pointAt(chainAxis, axis, offsets[offsets.length - 1]!, alongStart),
        pointAt(chainAxis, axis, range.max, alongStart),
        chainAxis,
        outward(pointAt(chainAxis, axis, range.max, alongStart), chainAxis, offset),
        `last ${layerId} to the opposite wall`,
        result.zoneId,
      ),
    );

    for (let i = 1; i < stops.length - 2; i++) {
      out.push(
        makeDimension(
          `${result.zoneId}:${layerId}:run${i}`,
          'running',
          pointAt(chainAxis, axis, stops[i]!, alongStart),
          pointAt(chainAxis, axis, stops[i + 1]!, alongStart),
          chainAxis,
          outward(pointAt(chainAxis, axis, stops[i]!, alongStart), chainAxis, offset),
          `${layerId} centres`,
          result.zoneId,
        ),
      );
    }
    level++;
  }

  // Overall sizes, on their own dimension line clear of the chains.
  const overallOffset = baseOffset + (level + 1) * lineGap;
  out.push(
    makeDimension(
      `${result.zoneId}:overall-along`,
      'overall',
      pointAt(u, n, along.min, across.min),
      pointAt(u, n, along.max, across.min),
      u,
      outward(pointAt(u, n, along.min, across.min), u, overallOffset),
      'overall, along the setout',
      result.zoneId,
    ),
  );
  out.push(
    makeDimension(
      `${result.zoneId}:overall-across`,
      'overall',
      pointAt(n, u, across.min, along.min),
      pointAt(n, u, across.max, along.min),
      n,
      outward(pointAt(n, u, across.min, along.min), n, overallOffset),
      'overall, across the setout',
      result.zoneId,
    ),
  );

  // Penetration centres, dimensioned off the setout datum on both axes.
  const datum = result.setout.origin;
  for (const pen of zone.penetrations) {
    const centre = penetrationCentre(pen);
    const label = pen.reference ?? pen.id;
    out.push(
      makeDimension(
        `${result.zoneId}:pen:${pen.id}:along`,
        'penetration',
        projectOnto(datum, centre, n, u),
        centre,
        u,
        0,
        `${label} centre, along the setout from the datum`,
        result.zoneId,
      ),
    );
    out.push(
      makeDimension(
        `${result.zoneId}:pen:${pen.id}:across`,
        'penetration',
        projectOnto(datum, centre, u, n),
        centre,
        n,
        0,
        `${label} centre, across the setout from the datum`,
        result.zoneId,
      ),
    );
  }

  // The true radius of every curved run, so a curve is dimensioned as a curve.
  for (const m of result.members) {
    if (!m.path || m.path.length < 3) continue;
    const fitted = fitArc(m.path.map((p) => ({ x: p.x, y: p.y })));
    if (!fitted) continue;
    out.push({
      id: `${result.zoneId}:radius:${m.id}`,
      kind: 'radial',
      a: fitted.centre,
      b: { x: quantise(fitted.centre.x + fitted.radius), y: quantise(fitted.centre.y) },
      direction: { x: 1, y: 0 },
      offset: 0,
      value: quantise(fitted.radius),
      text: `R${Math.round(fitted.radius)}`,
      note: `true radius of the curved run, dimensioned to the arc rather than to the ${m.path.length - 1} chords it was generated against`,
      zoneId: result.zoneId,
    });
  }

  // A zero dimension says nothing. A balanced lattice that lands exactly on a wall
  // produces one at each end, and drawing "0" there only collides with the figure
  // next to it.
  return out.filter((d) => d.kind === 'radial' || Math.round(d.value) > 0).sort((a, b) => a.id.localeCompare(b.id));
}

function layersPresent(result: ZoneResult): string[] {
  return [...new Set(result.members.filter((m) => m.planLength > 0 && m.type !== 'trim').map((m) => m.layerId))].sort();
}

function isAcross(m: Member, u: Vec2): boolean {
  const d = normalise(sub({ x: m.end.x, y: m.end.y }, { x: m.start.x, y: m.start.y }));
  return Math.abs(dot(d, u)) > Math.SQRT1_2;
}

/** The distinct positions of a layer's members, measured across the members. */
function uniqueOffsets(members: readonly Member[], axis: Vec2): number[] {
  const seen = new Set<number>();
  for (const m of members) seen.add(Math.round(dot({ x: m.start.x, y: m.start.y }, axis) * 1000) / 1000);
  return [...seen].sort((a, b) => a - b);
}

const pointAt = (axis: Vec2, other: Vec2, alongAxis: number, alongOther: number): Vec2 => ({
  x: quantise(axis.x * alongAxis + other.x * alongOther),
  y: quantise(axis.y * alongAxis + other.y * alongOther),
});

/** The point with `from`'s coordinate on `keep` and `to`'s on `measure`. */
function projectOnto(from: Vec2, to: Vec2, keep: Vec2, measure: Vec2): Vec2 {
  const base = scale(keep, dot(to, keep));
  const off = scale(measure, dot(from, measure));
  return { x: quantise(base.x + off.x), y: quantise(base.y + off.y) };
}

function makeDimension(
  id: string,
  kind: DimensionKind,
  a: Vec2,
  b: Vec2,
  direction: Vec2,
  offset: number,
  note: string,
  zoneId: string,
): Dimension {
  const value = quantise(Math.abs(dot(sub(b, a), direction)));
  return { id, kind, a, b, direction, offset, value, text: `${Math.round(value)}`, note, zoneId };
}

/**
 * Fit a circle to a run of points, so a curve generated against chords can be
 * dimensioned back to the arc it really is. Returns null when the points are not on
 * one arc.
 */
export function fitArc(points: readonly Vec2[]): { centre: Vec2; radius: number } | null {
  if (points.length < 3) return null;
  // Thirds rather than the two ends and the middle: a run around a column closes on
  // itself, so its first and last points coincide and the three would be degenerate.
  const n = points.length;
  const a = points[0]!;
  const b = points[Math.max(1, Math.round(n / 3))]!;
  const c = points[Math.min(n - 1, Math.round((2 * n) / 3))]!;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const ux =
    ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
  const uy =
    ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
  const centre = { x: quantise(ux), y: quantise(uy) };
  const radius = dist(centre, a);
  // Every point must sit on the same circle, or it is not an arc.
  for (const p of points) {
    if (Math.abs(dist(centre, p) - radius) > Math.max(1, radius * 0.02)) return null;
  }
  return { centre, radius };
}

/** A section cut through the void, with the drop at each hanger it passes. */
export interface SectionEntry {
  readonly memberId: string;
  /** Distance along the section line, mm. */
  readonly distance: number;
  readonly ceilingLevel: number;
  readonly structureLevel: number;
  readonly drop: number;
}

export interface Section {
  readonly id: string;
  readonly zoneId: string;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly length: number;
  readonly entries: readonly SectionEntry[];
  readonly note: string;
}

/**
 * A section through the void along a cut line.
 *
 * Reports the drop at every hanger within `width` of the line, which is what the
 * section is for: on a rake or over a stepped soffit the drops all differ, and the
 * installer needs the figure at each one rather than a single typical dimension.
 */
export function sectionThrough(
  result: ZoneResult,
  a: Vec2,
  b: Vec2,
  width = 300,
  id = 'section-1',
): Section {
  const u = normalise(sub(b, a));
  const n = perp(u);
  const length = dist(a, b);
  const entries: SectionEntry[] = [];

  for (const m of result.members) {
    if (m.type !== 'hanger') continue;
    const p = { x: m.start.x, y: m.start.y };
    const rel = sub(p, a);
    const alongDistance = dot(rel, u);
    if (alongDistance < -width || alongDistance > length + width) continue;
    if (Math.abs(dot(rel, n)) > width / 2) continue;
    entries.push({
      memberId: m.id,
      distance: quantise(alongDistance),
      ceilingLevel: quantise(Math.min(m.start.z, m.end.z)),
      structureLevel: quantise(Math.max(m.start.z, m.end.z)),
      drop: m.length,
    });
  }

  entries.sort((x, y) => x.distance - y.distance || x.memberId.localeCompare(y.memberId));
  return {
    id,
    zoneId: result.zoneId,
    a,
    b,
    length: quantise(length),
    entries,
    note: `section on a ${Math.round((angleOf(u) * 180) / Math.PI)} degree line, showing ${entries.length} hanger drop(s) within ${width}mm of the cut`,
  };
}

export { penetrationWidth, add, scale, type MultiPolygon };
