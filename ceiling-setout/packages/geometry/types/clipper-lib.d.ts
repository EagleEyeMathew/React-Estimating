declare namespace ClipperLib {
  interface IntPoint { X: number; Y: number }
  type Path = IntPoint[];
  type Paths = IntPoint[][];

  const PolyType: { ptSubject: number; ptClip: number };
  const ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
  const PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
  const JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
  const EndType: {
    etOpenSquare: number; etOpenRound: number; etOpenButt: number;
    etClosedLine: number; etClosedPolygon: number;
  };

  class PolyNode {
    Childs(): PolyNode[];
    Parent(): PolyNode | null;
    Contour(): IntPoint[];
    IsHole(): boolean;
    IsOpen(): boolean;
  }

  class PolyTree extends PolyNode {
    Clear(): void;
    Total(): number;
  }

  class Clipper {
    constructor(initOptions?: number);
    AddPath(path: IntPoint[], polyType: number, closed: boolean): boolean;
    AddPaths(paths: IntPoint[][], polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: PolyTree | IntPoint[][], subjFillType?: number, clipFillType?: number): boolean;
    Clear(): void;
    static OpenPathsFromPolyTree(polytree: PolyTree): IntPoint[][];
    static ClosedPathsFromPolyTree(polytree: PolyTree): IntPoint[][];
    static PolyTreeToPaths(polytree: PolyTree): IntPoint[][];
    static Area(path: IntPoint[]): number;
    static Orientation(path: IntPoint[]): boolean;
    static PointInPolygon(pt: IntPoint, path: IntPoint[]): number;
    static SimplifyPolygons(paths: IntPoint[][], fillType?: number): IntPoint[][];
    static CleanPolygons(paths: IntPoint[][], distance?: number): IntPoint[][];
  }

  class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: IntPoint[], joinType: number, endType: number): void;
    AddPaths(paths: IntPoint[][], joinType: number, endType: number): void;
    Execute(solution: PolyTree | IntPoint[][], delta: number): void;
    Clear(): void;
  }
}

declare module 'clipper-lib' {
  export = ClipperLib;
}
