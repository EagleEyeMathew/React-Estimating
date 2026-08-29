/** All linear values are millimetres unless explicitly stated. */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * A closed ring of vertices. The closing edge (last -> first) is implicit; the
 * first vertex is NOT repeated at the end.
 */
export type Ring = readonly Vec2[];

/** A simple polygon with holes. Outer ring is CCW, holes are CW after `normalisePolygon`. */
export interface Polygon {
  readonly outer: Ring;
  readonly holes: readonly Ring[];
}

/** A set of disjoint polygons - the result of most boolean operations. */
export type MultiPolygon = readonly Polygon[];

export interface Segment {
  readonly a: Vec2;
  readonly b: Vec2;
}

export interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * A circular arc between two points. Retained verbatim so drawings can dimension
 * back to the true arc after the setout has been generated against a tessellation.
 */
export interface Arc {
  readonly kind: 'arc';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly centre: Vec2;
  /** true = counter-clockwise from start to end. */
  readonly ccw: boolean;
}

export interface Line {
  readonly kind: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
}

export type BoundaryEdge = Line | Arc;

/**
 * A boundary described in terms of true edges (straight or arc). Tessellation to a
 * `Ring` is a lossy projection, so the edge list is kept alongside it.
 */
export interface BoundaryPath {
  readonly edges: readonly BoundaryEdge[];
  /** Max permitted distance between the chord and the true arc, in mm. */
  readonly chordTolerance: number;
}
