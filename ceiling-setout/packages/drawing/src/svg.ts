import { add, angleOf, normalise, perp, scale as vscale, sub, type Vec2 } from '@ceiling/geometry';
import type { Member, Zone, ZoneResult } from '@ceiling/engine';
import type { Dimension } from './dimensions.js';
import { boundsOf } from './dxf.js';

/**
 * A reflected ceiling plan as SVG.
 *
 * The same drawing as the PDF sheet, in a form the browser can show, hit-test and
 * restyle. Both are built from the engine's members and dimensions rather than from
 * each other, so neither can drift into showing something the model does not say.
 */

export interface SvgOptions {
  /** Rendered size in CSS pixels. */
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly showDimensions?: boolean;
  readonly showHangers?: boolean;
  readonly showPenetrations?: boolean;
  readonly showSetoutDatum?: boolean;
  /** Layer ids to draw. Defaults to all of them. */
  readonly layers?: readonly string[];
  readonly dark?: boolean;
}

interface Palette {
  readonly ink: string;
  readonly grid: string;
  readonly muted: string;
  readonly accent: string;
  readonly background: string;
  readonly member: Record<string, string>;
}

const LIGHT: Palette = {
  ink: '#1c1c1c',
  grid: '#c8c8c8',
  muted: '#7a7a7a',
  accent: '#b8351f',
  background: '#ffffff',
  member: {
    furring: '#2a7a3c',
    batten: '#2a7a3c',
    tsr: '#2a4d8f',
    main_tee: '#2a4d8f',
    rail: '#2a4d8f',
    cross_tee: '#5b8fc7',
    hanger: '#b8351f',
    bracket: '#7d569c',
    brace: '#7d569c',
    bridging: '#d97706',
    trim: '#6b6b6b',
  },
};

const DARK: Palette = {
  ink: '#e8e8e8',
  grid: '#4a4a4a',
  muted: '#9a9a9a',
  accent: '#ff7a5c',
  background: '#141414',
  member: {
    furring: '#5ec27a',
    batten: '#5ec27a',
    tsr: '#7aa7e8',
    main_tee: '#7aa7e8',
    rail: '#7aa7e8',
    cross_tee: '#a8c8ee',
    hanger: '#ff7a5c',
    bracket: '#c39ae0',
    brace: '#c39ae0',
    bridging: '#f0a92e',
    trim: '#9a9a9a',
  },
};

export function zoneToSvg(
  zone: Zone,
  result: ZoneResult,
  dimensions: readonly Dimension[] = [],
  options: SvgOptions = {},
): string {
  const width = options.width ?? 1200;
  const height = options.height ?? 800;
  const padding = options.padding ?? 24;
  const palette = options.dark ? DARK : LIGHT;

  const bounds = boundsOf(result.region);
  const pad = 1500;
  const min = { x: bounds.min.x - pad, y: bounds.min.y - pad };
  const max = { x: bounds.max.x + pad, y: bounds.max.y + pad };
  const modelWidth = Math.max(1, max.x - min.x);
  const modelHeight = Math.max(1, max.y - min.y);
  const k = Math.min((width - 2 * padding) / modelWidth, (height - 2 * padding) / modelHeight);
  // Screen y runs down; a ceiling plan reads the same way up as the model.
  const tx = (p: Vec2): [number, number] => [
    padding + (p.x - min.x) * k + (width - 2 * padding - modelWidth * k) / 2,
    height - padding - (p.y - min.y) * k - (height - 2 * padding - modelHeight * k) / 2,
  ];
  const w = (mm: number): number => Math.max(0.5, mm * k);

  const parts: string[] = [];
  const layerFilter = options.layers ? new Set(options.layers) : null;

  for (const poly of result.region) {
    parts.push(path(poly.outer, tx, palette.ink, 2, 'none'));
    for (const hole of poly.holes) parts.push(path(hole, tx, palette.ink, 2, palette.background));
  }

  for (const m of result.members) {
    if (layerFilter && !layerFilter.has(m.layerId)) continue;
    const colour = palette.member[m.type] ?? palette.muted;
    if (m.type === 'hanger' || m.planLength === 0) {
      if (m.type === 'hanger' && options.showHangers === false) continue;
      const [cx, cy] = tx({ x: m.start.x, y: m.start.y });
      parts.push(
        `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(Math.max(1.6, w(m.type === 'hanger' ? 45 : 25)))}" fill="none" stroke="${colour}" stroke-width="1.1" data-member="${escapeAttr(m.id)}"><title>${escapeAttr(describe(m))}</title></circle>`,
      );
      continue;
    }
    const points = m.path ? m.path.map((p) => ({ x: p.x, y: p.y })) : [{ x: m.start.x, y: m.start.y }, { x: m.end.x, y: m.end.y }];
    const stroke = m.type === 'trim' ? 1.8 : m.type === 'tsr' || m.type === 'main_tee' ? 1.5 : 1;
    parts.push(
      `<polyline points="${points.map((p) => tx(p).map(round).join(',')).join(' ')}" fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" data-member="${escapeAttr(m.id)}"><title>${escapeAttr(describe(m))}</title></polyline>`,
    );
  }

  if (options.showPenetrations !== false) {
    for (const pen of zone.penetrations) {
      if (pen.shape.kind === 'circle') {
        const [cx, cy] = tx(pen.shape.centre);
        parts.push(
          `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(Math.max(2, pen.shape.radius * k))}" fill="none" stroke="${palette.accent}" stroke-width="1.2" stroke-dasharray="3 2"><title>${escapeAttr(`${pen.kind} ${pen.reference ?? pen.id}`)}</title></circle>`,
        );
      } else {
        const { centre, width: pw, height: ph, rotation } = pen.shape;
        const c = Math.cos(rotation);
        const s = Math.sin(rotation);
        const pts = [
          [-pw / 2, -ph / 2],
          [pw / 2, -ph / 2],
          [pw / 2, ph / 2],
          [-pw / 2, ph / 2],
        ].map(([dx, dy]) => ({ x: centre.x + dx! * c - dy! * s, y: centre.y + dx! * s + dy! * c }));
        parts.push(
          `<polygon points="${pts.map((p) => tx(p).map(round).join(',')).join(' ')}" fill="none" stroke="${palette.accent}" stroke-width="1.2" stroke-dasharray="3 2"><title>${escapeAttr(`${pen.kind} ${pen.reference ?? pen.id}`)}</title></polygon>`,
        );
      }
    }
  }

  if (options.showDimensions !== false) {
    for (const d of dimensions) parts.push(dimensionSvg(d, tx, palette));
  }

  if (options.showSetoutDatum !== false) {
    const o = result.setout.origin;
    const u = normalise(result.setout.direction);
    const n = perp(u);
    const tick = 500;
    parts.push(lineSvg(sub(o, vscale(u, tick)), add(o, vscale(u, tick)), tx, palette.accent, 1.4));
    parts.push(lineSvg(sub(o, vscale(n, tick)), add(o, vscale(n, tick)), tx, palette.accent, 1.4));
    const [lx, ly] = tx(add(o, vscale(n, tick * 1.6)));
    parts.push(
      `<text x="${round(lx)}" y="${round(ly)}" font-family="ui-monospace, monospace" font-size="10" fill="${palette.accent}">DATUM ${Math.round(o.x)}, ${Math.round(o.y)}</text>`,
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Reflected ceiling plan for ${escapeAttr(result.zoneName)}">`,
    `<rect width="${width}" height="${height}" fill="${palette.background}"/>`,
    ...parts,
    '</svg>',
  ].join('\n');
}

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function dimensionSvg(d: Dimension, tx: (p: Vec2) => [number, number], palette: Palette): string {
  if (d.kind === 'radial') {
    const [x, y] = tx(d.b);
    return `<text x="${round(x)}" y="${round(y)}" font-family="ui-sans-serif, system-ui" font-size="9" fill="${palette.muted}">${d.text}</text>`;
  }
  const u = normalise(d.direction);
  const n = perp(u);
  const off = vscale(n, d.offset);
  const a = add(d.a, off);
  const b = add(d.b, off);
  const [ax, ay] = tx(a);
  const [bx, by] = tx(b);
  const [px, py] = tx(d.a);
  const [qx, qy] = tx(d.b);
  // Text goes between the ticks when it fits and outside when it does not, which is
  // what stops a 150mm dimension writing over the 450 next to it.
  // A figure that will not fit between its ticks goes on a second row further out,
  // not squeezed along the line - pushing it past a tick only walks it into the
  // neighbouring figure at whichever end of the chain it happens to be.
  const drawn = Math.hypot(bx - ax, by - ay);
  const tight = d.text.length * 5.5 > drawn;
  const [ox, oy] = tx(add(midpoint(d.a, d.b), vscale(n, d.offset + (tight ? Math.sign(d.offset || 1) * 260 : 0))));
  const midX = ox;
  const midY = oy;
  const anchor = 'middle';
  const angle = -((angleOf(u) * 180) / Math.PI);
  const flipped = angle > 90 || angle < -90 ? angle + 180 : angle;
  return [
    `<line x1="${round(ax)}" y1="${round(ay)}" x2="${round(bx)}" y2="${round(by)}" stroke="${palette.grid}" stroke-width="0.8"/>`,
    `<line x1="${round(px)}" y1="${round(py)}" x2="${round(ax)}" y2="${round(ay)}" stroke="${palette.grid}" stroke-width="0.5"/>`,
    `<line x1="${round(qx)}" y1="${round(qy)}" x2="${round(bx)}" y2="${round(by)}" stroke="${palette.grid}" stroke-width="0.5"/>`,
    `<text x="${round(midX)}" y="${round(midY - 2)}" transform="rotate(${round(flipped)} ${round(midX)} ${round(midY - 2)})" text-anchor="${anchor}" font-family="ui-sans-serif, system-ui" font-size="9" fill="${palette.ink}">${d.text}</text>`,
  ].join('\n');
}

const describe = (m: Member): string =>
  `${m.layerId} ${m.productCode ?? '(no product)'} - ${Math.round(m.length)}mm\n${m.provenance.reason}\n${m.provenance.ruleId} (${m.provenance.rulePackVersion})`;

function path(ring: readonly Vec2[], tx: (p: Vec2) => [number, number], stroke: string, width: number, fill: string): string {
  return `<polygon points="${ring.map((p) => tx(p).map(round).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
}

function lineSvg(a: Vec2, b: Vec2, tx: (p: Vec2) => [number, number], stroke: string, width: number): string {
  const [x1, y1] = tx(a);
  const [x2, y2] = tx(b);
  return `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="${width}"/>`;
}

const round = (v: number): number => Math.round(v * 100) / 100;

const escapeAttr = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
