import { add, angleOf, dot, normalise, perp, scale, sub, type MultiPolygon, type Vec2 } from '@ceiling/geometry';
import type { GenerationResult, Member, Zone, ZoneResult } from '@ceiling/engine';
import type { Dimension } from './dimensions.js';

/**
 * DXF R12 ASCII.
 *
 * R12 rather than a later release on purpose: it is the format every CAD program
 * still reads without complaint, and a setout plan needs nothing newer. Dimensions
 * are written as their component lines, arrows and text rather than as DIMENSION
 * entities, so the numbers on the drawing are the numbers the engine computed and
 * cannot be re-measured to something else by the receiving program's dimension style.
 */

export interface DxfLayer {
  readonly name: string;
  readonly colour: number;
}

/** AutoCAD colour indices. Chosen so the plan reads on a monochrome plot. */
export const DXF_LAYERS: Record<string, DxfLayer> = {
  BOUNDARY: { name: 'CEIL-BOUNDARY', colour: 7 },
  OPENING: { name: 'CEIL-OPENING', colour: 1 },
  FURRING: { name: 'CEIL-FURRING', colour: 3 },
  TSR: { name: 'CEIL-TSR', colour: 5 },
  MAIN_TEE: { name: 'CEIL-MAIN-TEE', colour: 5 },
  CROSS_TEE: { name: 'CEIL-CROSS-TEE', colour: 4 },
  BATTEN: { name: 'CEIL-BATTEN', colour: 3 },
  RAIL: { name: 'CEIL-RAIL', colour: 5 },
  HANGER: { name: 'CEIL-HANGER', colour: 2 },
  BRACKET: { name: 'CEIL-BRACKET', colour: 6 },
  BRACE: { name: 'CEIL-BRACE', colour: 6 },
  BRIDGING: { name: 'CEIL-BRIDGING', colour: 1 },
  TRIM: { name: 'CEIL-TRIM', colour: 8 },
  PENETRATION: { name: 'CEIL-SERVICES', colour: 6 },
  DIMENSION: { name: 'CEIL-DIMS', colour: 7 },
  TEXT: { name: 'CEIL-TEXT', colour: 7 },
  SETOUT: { name: 'CEIL-SETOUT', colour: 1 },
};

const layerFor = (m: Member): DxfLayer =>
  DXF_LAYERS[m.type.toUpperCase()] ?? DXF_LAYERS[m.layerId.toUpperCase()] ?? DXF_LAYERS.TEXT!;

class DxfWriter {
  private readonly parts: string[] = [];

  private pair(code: number, value: string | number): void {
    this.parts.push(String(code), String(value));
  }

  header(min: Vec2, max: Vec2): this {
    this.pair(0, 'SECTION');
    this.pair(2, 'HEADER');
    this.pair(9, '$ACADVER');
    this.pair(1, 'AC1009');
    this.pair(9, '$INSUNITS');
    this.pair(70, 4); // millimetres
    this.pair(9, '$EXTMIN');
    this.pair(10, min.x);
    this.pair(20, min.y);
    this.pair(9, '$EXTMAX');
    this.pair(10, max.x);
    this.pair(20, max.y);
    this.pair(0, 'ENDSEC');
    return this;
  }

  tables(layers: readonly DxfLayer[]): this {
    this.pair(0, 'SECTION');
    this.pair(2, 'TABLES');
    this.pair(0, 'TABLE');
    this.pair(2, 'LAYER');
    this.pair(70, layers.length);
    for (const l of layers) {
      this.pair(0, 'LAYER');
      this.pair(2, l.name);
      this.pair(70, 0);
      this.pair(62, l.colour);
      this.pair(6, 'CONTINUOUS');
    }
    this.pair(0, 'ENDTAB');
    this.pair(0, 'ENDSEC');
    return this;
  }

  beginEntities(): this {
    this.pair(0, 'SECTION');
    this.pair(2, 'ENTITIES');
    return this;
  }

  line(layer: string, a: Vec2, b: Vec2, elevation = 0): this {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    this.pair(10, a.x);
    this.pair(20, a.y);
    this.pair(30, elevation);
    this.pair(11, b.x);
    this.pair(21, b.y);
    this.pair(31, elevation);
    return this;
  }

  polyline(layer: string, points: readonly Vec2[], closed: boolean, elevation = 0): this {
    if (points.length < 2) return this;
    this.pair(0, 'POLYLINE');
    this.pair(8, layer);
    this.pair(66, 1);
    this.pair(10, 0);
    this.pair(20, 0);
    this.pair(30, elevation);
    this.pair(70, closed ? 1 : 0);
    for (const p of points) {
      this.pair(0, 'VERTEX');
      this.pair(8, layer);
      this.pair(10, p.x);
      this.pair(20, p.y);
      this.pair(30, elevation);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, layer);
    return this;
  }

  circle(layer: string, centre: Vec2, radius: number, elevation = 0): this {
    this.pair(0, 'CIRCLE');
    this.pair(8, layer);
    this.pair(10, centre.x);
    this.pair(20, centre.y);
    this.pair(30, elevation);
    this.pair(40, radius);
    return this;
  }

  text(layer: string, at: Vec2, height: number, value: string, rotationDegrees = 0, align: 0 | 1 | 2 = 0): this {
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.pair(10, at.x);
    this.pair(20, at.y);
    this.pair(30, 0);
    this.pair(40, height);
    this.pair(1, value);
    this.pair(50, rotationDegrees);
    this.pair(72, align);
    if (align !== 0) {
      this.pair(11, at.x);
      this.pair(21, at.y);
      this.pair(31, 0);
    }
    return this;
  }

  end(): string {
    this.pair(0, 'ENDSEC');
    this.pair(0, 'EOF');
    // DXF is line-based and CRLF is what every reader expects.
    return `${this.parts.join('\r\n')}\r\n`;
  }
}

export interface DxfOptions {
  /** Text height in drawing units (mm). */
  readonly textHeight?: number;
  readonly includeDimensions?: boolean;
  readonly includeHangers?: boolean;
  /** Radius of the circle drawn for a hanger, mm. */
  readonly hangerRadius?: number;
}

/** A reflected ceiling plan for one zone. */
export function zoneToDxf(
  zone: Zone,
  result: ZoneResult,
  dimensions: readonly Dimension[] = [],
  options: DxfOptions = {},
): string {
  const textHeight = options.textHeight ?? 100;
  const hangerRadius = options.hangerRadius ?? 40;
  const w = new DxfWriter();
  const bounds = boundsOf(result.region);
  w.header(bounds.min, bounds.max);
  w.tables(Object.values(DXF_LAYERS));
  w.beginEntities();

  for (const poly of result.region) {
    w.polyline(DXF_LAYERS.BOUNDARY!.name, poly.outer, true);
    for (const hole of poly.holes) w.polyline(DXF_LAYERS.OPENING!.name, hole, true);
  }

  for (const m of result.members) {
    const layer = layerFor(m).name;
    if (m.type === 'hanger') {
      if (options.includeHangers !== false) w.circle(layer, { x: m.start.x, y: m.start.y }, hangerRadius);
      continue;
    }
    if (m.planLength === 0) {
      w.circle(layer, { x: m.start.x, y: m.start.y }, hangerRadius / 2);
      continue;
    }
    if (m.path) w.polyline(layer, m.path.map((p) => ({ x: p.x, y: p.y })), false);
    else w.line(layer, { x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y });
  }

  for (const pen of zone.penetrations) {
    const shape = pen.shape;
    if (shape.kind === 'circle') {
      w.circle(DXF_LAYERS.PENETRATION!.name, shape.centre, shape.radius);
    } else {
      w.polyline(DXF_LAYERS.PENETRATION!.name, rectPoints(shape.centre, shape.width, shape.height, shape.rotation), true);
    }
    w.text(
      DXF_LAYERS.TEXT!.name,
      { x: shape.centre.x, y: shape.centre.y + textHeight },
      textHeight * 0.8,
      pen.reference ?? pen.id,
    );
  }

  // The setout datum, so the plan can be set out on site from a known point.
  const origin = result.setout.origin;
  const tick = textHeight * 3;
  const u = normalise(result.setout.direction);
  const n = perp(u);
  w.line(DXF_LAYERS.SETOUT!.name, sub(origin, scale(u, tick)), add(origin, scale(u, tick)));
  w.line(DXF_LAYERS.SETOUT!.name, sub(origin, scale(n, tick)), add(origin, scale(n, tick)));
  w.text(
    DXF_LAYERS.TEXT!.name,
    add(origin, scale(n, tick * 1.3)),
    textHeight,
    `SETOUT DATUM  ${Math.round(origin.x)}, ${Math.round(origin.y)}  ${result.setout.directionDegrees} deg`,
  );

  if (options.includeDimensions !== false) {
    for (const d of dimensions) drawDimension(w, d, textHeight);
  }

  return w.end();
}

/** The whole project as one DXF, zones side by side in their true positions. */
export function projectToDxf(
  result: GenerationResult,
  zones: readonly Zone[],
  dimensions: readonly Dimension[] = [],
  options: DxfOptions = {},
): string {
  const parts = result.zones.map((z) => {
    const zone = zones.find((x) => x.id === z.zoneId);
    return zone ? zoneToDxf(zone, z, dimensions.filter((d) => d.zoneId === z.zoneId), options) : '';
  });
  // Merging DXF text would produce two headers, so the zones are re-emitted as one
  // drawing rather than concatenated.
  return parts.length === 1 ? parts[0]! : mergeDxf(parts);
}

/**
 * Merge several single-zone drawings into one by keeping the first drawing's header
 * and tables and appending everyone else's entities.
 */
function mergeDxf(parts: readonly string[]): string {
  if (parts.length === 0) return new DxfWriter().header({ x: 0, y: 0 }, { x: 0, y: 0 }).tables([]).beginEntities().end();
  const first = parts[0]!;
  const head = first.slice(0, first.lastIndexOf('0\r\nENDSEC\r\n0\r\nEOF'));
  const bodies = parts.slice(1).map((p) => {
    const start = p.indexOf('2\r\nENTITIES\r\n');
    const end = p.lastIndexOf('0\r\nENDSEC\r\n0\r\nEOF');
    return start < 0 || end < 0 ? '' : p.slice(start + '2\r\nENTITIES\r\n'.length, end);
  });
  return `${head}${bodies.join('')}0\r\nENDSEC\r\n0\r\nEOF\r\n`;
}

function drawDimension(w: DxfWriter, d: Dimension, textHeight: number): void {
  const layer = DXF_LAYERS.DIMENSION!.name;
  if (d.kind === 'radial') {
    w.text(DXF_LAYERS.TEXT!.name, d.b, textHeight, d.text);
    w.line(layer, d.a, d.b);
    return;
  }
  const u = normalise(d.direction);
  const n = perp(u);
  const off = scale(n, d.offset);
  const a = add(d.a, off);
  const b = add(d.b, off);
  w.line(layer, a, b);
  // Extension lines back to the points being measured.
  w.line(layer, d.a, add(a, scale(n, textHeight * 0.5)));
  w.line(layer, d.b, add(b, scale(n, textHeight * 0.5)));
  // Ticks rather than arrowheads: they survive any scale.
  const tick = scale(normalise({ x: u.x + n.x, y: u.y + n.y }), textHeight * 0.7);
  w.line(layer, sub(a, tick), add(a, tick));
  w.line(layer, sub(b, tick), add(b, tick));
  const mid = scale(add(a, b), 0.5);
  const rotation = ((angleOf(u) * 180) / Math.PI + 360) % 360;
  const flipped = rotation > 90 && rotation < 270 ? rotation - 180 : rotation;
  w.text(DXF_LAYERS.TEXT!.name, add(mid, scale(n, textHeight * 0.4)), textHeight, d.text, flipped, 1);
}

function rectPoints(centre: Vec2, width: number, height: number, rotation: number): Vec2[] {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const hw = width / 2;
  const hh = height / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => ({ x: centre.x + dx! * c - dy! * s, y: centre.y + dx! * s + dy! * c }));
}

export function boundsOf(region: MultiPolygon): { min: Vec2; max: Vec2 } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of region) {
    for (const p of poly.outer) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return Number.isFinite(minX)
    ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
    : { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
}

export { dot };
