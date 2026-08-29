import ClipperLib from 'clipper-lib';
import type { MultiPolygon, Polygon, Ring, Segment, Vec2 } from './types.js';
import { normalisePolygon } from './polygon.js';
import { area } from './ring.js';
import { EPS, quantise } from './num.js';

type IntPoint = ClipperLib.IntPoint;

/**
 * Clipper works on integers. Everything crosses into its domain scaled by SCALE and
 * comes back out divided by it, which is also what makes boolean results
 * reproducible: the same input always lands on the same integer lattice, so there is
 * no floating point drift between runs.
 */
export const SCALE = 1000; // 1 integer unit = 0.001 mm

const MITER_LIMIT = 2;
const ARC_TOLERANCE = 0.25 * SCALE;

export const toInt = (v: number): number => Math.round(v * SCALE);
export const fromInt = (v: number): number => quantise(v / SCALE);

export const ringToPath = (r: Ring): IntPoint[] => r.map((p) => ({ X: toInt(p.x), Y: toInt(p.y) }));
export const pathToRing = (p: readonly IntPoint[]): Vec2[] => p.map((q) => ({ x: fromInt(q.X), y: fromInt(q.Y) }));

export function polygonToPaths(p: Polygon): IntPoint[][] {
  const n = normalisePolygon(p);
  return [ringToPath(n.outer), ...n.holes.map(ringToPath)];
}

export function multiPolygonToPaths(mp: MultiPolygon): IntPoint[][] {
  return mp.flatMap(polygonToPaths);
}

interface PolyNodeLike {
  Childs(): PolyNodeLike[];
  Contour(): IntPoint[];
  IsHole(): boolean;
}

/**
 * Walk a Clipper PolyTree into nested polygons. The tree already expresses
 * containment, so an island inside a hole comes back as its own polygon rather
 * than being silently merged into the parent.
 */
function walkTree(node: PolyNodeLike, out: Polygon[]): void {
  for (const child of node.Childs()) {
    // A child of the root (or of a hole) is an outer ring.
    const outer = pathToRing(child.Contour());
    const holes: Vec2[][] = [];
    for (const grandchild of child.Childs()) {
      holes.push(pathToRing(grandchild.Contour()));
      // Anything inside a hole starts a fresh polygon.
      walkTree(grandchild, out);
    }
    if (outer.length >= 3 && area(outer) > EPS) {
      out.push(normalisePolygon({ outer, holes: holes.filter((h) => h.length >= 3) }));
    }
  }
}

export function polyTreeToMultiPolygon(tree: ClipperLib.PolyTree): MultiPolygon {
  const out: Polygon[] = [];
  walkTree(tree as unknown as PolyNodeLike, out);
  return sortMultiPolygon(out);
}

/**
 * Canonical ordering. Clipper's output order depends on its internal scanbeam, so
 * results are sorted before they leave this module - two runs that differ only in
 * ordering would otherwise break the determinism guarantee.
 */
export function sortMultiPolygon(mp: MultiPolygon): Polygon[] {
  const withKey = mp.map((p) => ({ p: { ...p, outer: rotateRingToCanonicalStart(p.outer), holes: p.holes.map(rotateRingToCanonicalStart) }, k: ringKey(p.outer) }));
  withKey.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return withKey.map((w) => ({ ...w.p, holes: [...w.p.holes].sort((a, b) => (ringKey(a) < ringKey(b) ? -1 : 1)) }));
}

function ringKey(r: Ring): string {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of r) {
    if (p.x < minX || (p.x === minX && p.y < minY)) {
      minX = p.x;
      minY = p.y;
    }
  }
  return `${minX.toFixed(3)}|${minY.toFixed(3)}|${r.length}`;
}

/** Start each ring at its lexicographically lowest vertex so JSON output is stable. */
function rotateRingToCanonicalStart(r: Ring): Vec2[] {
  if (r.length === 0) return [];
  let best = 0;
  for (let i = 1; i < r.length; i++) {
    const a = r[i]!;
    const b = r[best]!;
    if (a.x < b.x - EPS || (Math.abs(a.x - b.x) <= EPS && a.y < b.y - EPS)) best = i;
  }
  return [...r.slice(best), ...r.slice(0, best)];
}

export type BooleanOp = 'union' | 'difference' | 'intersection' | 'xor';

const CLIP_TYPE: Record<BooleanOp, number> = {
  union: ClipperLib.ClipType.ctUnion,
  difference: ClipperLib.ClipType.ctDifference,
  intersection: ClipperLib.ClipType.ctIntersection,
  xor: ClipperLib.ClipType.ctXor,
};

export function booleanOp(op: BooleanOp, subject: MultiPolygon, clip: MultiPolygon): MultiPolygon {
  const subjPaths = multiPolygonToPaths(subject);
  const clipPaths = multiPolygonToPaths(clip);
  if (subjPaths.length === 0) return op === 'union' ? sortMultiPolygon(clip.map(normalisePolygon)) : [];
  const cpr = new ClipperLib.Clipper();
  cpr.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
  if (clipPaths.length > 0) cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  cpr.Execute(CLIP_TYPE[op], tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return polyTreeToMultiPolygon(tree);
}

export type JoinStyle = 'miter' | 'round' | 'square';

const JOIN_TYPE: Record<JoinStyle, number> = {
  miter: ClipperLib.JoinType.jtMiter,
  round: ClipperLib.JoinType.jtRound,
  square: ClipperLib.JoinType.jtSquare,
};

/**
 * Offset (buffer) a polygon set. Negative delta shrinks it, which is what perimeter
 * setback rules need. Clipper's offsetter handles reflex corners properly - it
 * resolves the self-intersections a naive vertex nudge would leave behind, and drops
 * regions that vanish entirely when the offset exceeds their half-width.
 */
export function offsetMultiPolygon(mp: MultiPolygon, delta: number, join: JoinStyle = 'miter'): MultiPolygon {
  if (Math.abs(delta) < EPS) return mp.map(normalisePolygon);
  const paths = multiPolygonToPaths(mp);
  if (paths.length === 0) return [];
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE);
  co.AddPaths(paths, JOIN_TYPE[join], ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, delta * SCALE);
  return polyTreeToMultiPolygon(tree);
}

/**
 * Clip open paths against a polygon set, returning the parts that fall inside.
 * A single line across a concave room or across a hole comes back as several
 * disjoint pieces - which is exactly the behaviour the setout depends on.
 */
export function clipOpenPaths(paths: readonly (readonly Vec2[])[], clip: MultiPolygon): Vec2[][] {
  const clipPaths = multiPolygonToPaths(clip);
  if (clipPaths.length === 0 || paths.length === 0) return [];
  const cpr = new ClipperLib.Clipper();
  for (const p of paths) {
    if (p.length >= 2) cpr.AddPath(p.map((q) => ({ X: toInt(q.x), Y: toInt(q.y) })), ClipperLib.PolyType.ptSubject, false);
  }
  cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  cpr.Execute(ClipperLib.ClipType.ctIntersection, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.Clipper.OpenPathsFromPolyTree(tree).map(pathToRing);
}

/** Clip a straight segment against a polygon set. */
export function clipSegment(seg: Segment, clip: MultiPolygon): Segment[] {
  return clipOpenPaths([[seg.a, seg.b]], clip)
    .filter((p) => p.length >= 2)
    .map((p) => ({ a: p[0]!, b: p[p.length - 1]! }));
}
