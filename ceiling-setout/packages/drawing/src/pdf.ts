import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { add, angleOf, normalise, perp, scale as vscale, sub, type Vec2 } from '@ceiling/geometry';
import type { GenerationResult, Zone, ZoneResult } from '@ceiling/engine';
import type { Dimension, Section } from './dimensions.js';
import type { Table } from './schedules.js';
import { boundsOf } from './dxf.js';
import { SHEET_SIZES, fitViewport, mmToPt, scaleText, toSheet, type SheetSize, type TitleBlock, type Viewport } from './sheet.js';

const INK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.72, 0.72, 0.72);
const ACCENT = rgb(0.75, 0.2, 0.15);

/** Line weights in millimetres, so they read the same at any sheet size. */
const WEIGHTS = { boundary: 0.5, member: 0.18, secondary: 0.25, trim: 0.3, dim: 0.13, frame: 0.35 };

const COLOURS: Record<string, ReturnType<typeof rgb>> = {
  furring: rgb(0.15, 0.45, 0.2),
  batten: rgb(0.15, 0.45, 0.2),
  main_tee: rgb(0.15, 0.3, 0.6),
  tsr: rgb(0.15, 0.3, 0.6),
  rail: rgb(0.15, 0.3, 0.6),
  cross_tee: rgb(0.3, 0.55, 0.75),
  hanger: ACCENT,
  bracket: rgb(0.5, 0.35, 0.6),
  brace: rgb(0.5, 0.35, 0.6),
  bridging: ACCENT,
  trim: GREY,
};

export interface PdfOptions {
  readonly size?: SheetSize;
  readonly titleBlock: Omit<TitleBlock, 'scaleText'>;
  readonly dimensions?: readonly Dimension[];
  readonly sections?: readonly Section[];
  readonly tables?: readonly Table[];
}

/**
 * Shop drawing sheets: a reflected ceiling plan per zone, any sections, then the
 * schedules.
 *
 * Every sheet carries the same title block, and the title block always carries the
 * standing of the numbers the drawing was generated from. A sheet that does not say
 * what its figures rest on is the failure mode this app exists to avoid, so the note
 * is not optional and not configurable away.
 */
export async function buildPdf(
  result: GenerationResult,
  zones: readonly Zone[],
  options: PdfOptions,
): Promise<Uint8Array> {
  const size = options.size ?? 'A3';
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(`${options.titleBlock.project} - ${options.titleBlock.drawingTitle}`);
  doc.setProducer('Ceiling setout');
  doc.setCreator('Ceiling setout');

  for (const zoneResult of result.zones) {
    const zone = zones.find((z) => z.id === zoneResult.zoneId);
    if (!zone) continue;
    drawPlanSheet(doc, font, bold, size, zone, zoneResult, result, options);
  }

  for (const section of options.sections ?? []) {
    drawSectionSheet(doc, font, bold, size, section, options);
  }

  for (const table of options.tables ?? []) {
    drawTableSheets(doc, font, bold, size, table, options);
  }

  if (doc.getPageCount() === 0) {
    const page = newPage(doc, size);
    drawFrameAndTitleBlock(page, font, bold, size, { ...options.titleBlock, scaleText: 'NTS' });
    text(page, font, 'Nothing was generated. See the issues report.', 20, SHEET_SIZES[size].height - 40, 3.5, INK);
  }

  return doc.save();
}

function newPage(doc: PDFDocument, size: SheetSize): PDFPage {
  const s = SHEET_SIZES[size];
  return doc.addPage([mmToPt(s.width), mmToPt(s.height)]);
}

function drawPlanSheet(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  size: SheetSize,
  zone: Zone,
  zoneResult: ZoneResult,
  result: GenerationResult,
  options: PdfOptions,
): void {
  const page = newPage(doc, size);
  const bounds = boundsOf(zoneResult.region);
  // Leave room around the plan for the dimension lines that sit outside it.
  const pad = 1200;
  const viewport = fitViewport(
    { x: bounds.min.x - pad, y: bounds.min.y - pad },
    { x: bounds.max.x + pad, y: bounds.max.y + pad },
    size,
  );
  const title: TitleBlock = {
    ...options.titleBlock,
    drawingTitle: `${options.titleBlock.drawingTitle} - ${zoneResult.zoneName}`,
    scaleText: scaleText(viewport.scale),
  };
  drawFrameAndTitleBlock(page, font, bold, size, title);

  for (const poly of zoneResult.region) {
    polyline(page, poly.outer, viewport, INK, WEIGHTS.boundary, true);
    for (const hole of poly.holes) polyline(page, hole, viewport, INK, WEIGHTS.boundary, true);
  }

  for (const m of zoneResult.members) {
    const colour = COLOURS[m.type] ?? GREY;
    if (m.type === 'hanger' || m.planLength === 0) {
      circle(page, { x: m.start.x, y: m.start.y }, 45, viewport, colour, WEIGHTS.member);
      continue;
    }
    if (m.path) polyline(page, m.path.map((p) => ({ x: p.x, y: p.y })), viewport, colour, WEIGHTS.trim, false);
    else
      line(
        page,
        { x: m.start.x, y: m.start.y },
        { x: m.end.x, y: m.end.y },
        viewport,
        colour,
        m.type === 'trim' ? WEIGHTS.trim : m.type === 'tsr' || m.type === 'main_tee' ? WEIGHTS.secondary : WEIGHTS.member,
      );
  }

  for (const pen of zone.penetrations) {
    if (pen.shape.kind === 'circle') {
      circle(page, pen.shape.centre, pen.shape.radius, viewport, ACCENT, WEIGHTS.trim);
    } else {
      const { centre, width, height, rotation } = pen.shape;
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      const pts = [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
      ].map(([dx, dy]) => ({ x: centre.x + dx! * c - dy! * s, y: centre.y + dx! * s + dy! * c }));
      polyline(page, pts, viewport, ACCENT, WEIGHTS.trim, true);
    }
  }

  for (const d of options.dimensions ?? []) {
    if (d.zoneId === zoneResult.zoneId) drawDimension(page, font, d, viewport);
  }

  drawSetoutDatum(page, font, zoneResult, viewport);
  drawLegend(page, font, bold, size, zoneResult, viewport);
}

function drawSetoutDatum(page: PDFPage, font: PDFFont, zoneResult: ZoneResult, viewport: Viewport): void {
  const o = zoneResult.setout.origin;
  const u = normalise(zoneResult.setout.direction);
  const n = perp(u);
  const tick = 400;
  line(page, sub(o, vscale(u, tick)), add(o, vscale(u, tick)), viewport, ACCENT, 0.3);
  line(page, sub(o, vscale(n, tick)), add(o, vscale(n, tick)), viewport, ACCENT, 0.3);
  const at = toSheet(add(o, vscale(n, tick * 1.4)), viewport);
  text(page, font, `SETOUT DATUM ${Math.round(o.x)}, ${Math.round(o.y)}`, at.x, at.y, 2.2, ACCENT);
}

function drawLegend(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: SheetSize,
  zoneResult: ZoneResult,
  viewport: Viewport,
): void {
  const sheet = SHEET_SIZES[size];
  let y = sheet.height - 20;
  const x = viewport.frame.x + 2;
  text(page, bold, 'SETOUT', x, y, 3, INK);
  y -= 4;
  text(page, font, zoneResult.setout.directionReason, x, y, 2.2, GREY);
  y -= 3.2;
  text(page, font, zoneResult.setout.originReason, x, y, 2.2, GREY);
  y -= 4;
  for (const [layerId, s] of Object.entries(zoneResult.spacings)) {
    if (s.spacing === null) continue;
    text(page, font, `${layerId} at ${s.spacing}mm - ${s.governedBy}`, x, y, 2.2, GREY);
    y -= 3.2;
  }
}

function drawSectionSheet(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  size: SheetSize,
  section: Section,
  options: PdfOptions,
): void {
  const page = newPage(doc, size);
  const sheet = SHEET_SIZES[size];
  drawFrameAndTitleBlock(page, font, bold, size, {
    ...options.titleBlock,
    drawingTitle: `${options.titleBlock.drawingTitle} - ${section.id}`,
    scaleText: 'NTS',
  });

  let y = sheet.height - 25;
  text(page, bold, `SECTION ${section.id.toUpperCase()}`, 18, y, 4, INK);
  y -= 5;
  text(page, font, section.note, 18, y, 2.4, GREY);
  y -= 8;

  if (section.entries.length === 0) {
    text(page, font, 'No hangers fall within this cut.', 18, y, 2.8, INK);
    return;
  }

  // Draw the void to scale horizontally and exaggerated vertically, which is what a
  // void section is for: the drops are the information, not the proportions.
  const left = 20;
  const right = sheet.width - 75;
  const width = right - left;
  const levels = section.entries.flatMap((e) => [e.ceilingLevel, e.structureLevel]);
  const minLevel = Math.min(...levels);
  const maxLevel = Math.max(...levels);
  const top = y;
  const height = 60;
  const yFor = (level: number): number =>
    top - height + ((level - minLevel) / Math.max(1, maxLevel - minLevel)) * height;

  const xFor = (d: number): number => left + (d / Math.max(1, section.length)) * width;

  // Structure and ceiling lines.
  for (let i = 1; i < section.entries.length; i++) {
    const a = section.entries[i - 1]!;
    const b = section.entries[i]!;
    sheetLine(page, xFor(a.distance), yFor(a.structureLevel), xFor(b.distance), yFor(b.structureLevel), INK, 0.4);
    sheetLine(page, xFor(a.distance), yFor(a.ceilingLevel), xFor(b.distance), yFor(b.ceilingLevel), INK, 0.4);
  }
  for (const e of section.entries) {
    sheetLine(page, xFor(e.distance), yFor(e.ceilingLevel), xFor(e.distance), yFor(e.structureLevel), ACCENT, 0.3);
    text(page, font, `${Math.round(e.drop)}`, xFor(e.distance) + 0.8, (yFor(e.ceilingLevel) + yFor(e.structureLevel)) / 2, 2.2, ACCENT);
    text(page, font, `${Math.round(e.distance)}`, xFor(e.distance) + 0.8, yFor(minLevel) - 4, 2, GREY);
  }
  text(page, font, 'Drops shown in mm. Vertical exaggerated.', left, yFor(minLevel) - 9, 2.2, GREY);
}

function drawTableSheets(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  size: SheetSize,
  table: Table,
  options: PdfOptions,
): void {
  const sheet = SHEET_SIZES[size];
  const rowHeight = 4.2;
  const top = sheet.height - 32;
  const bottom = 20;
  const perPage = Math.max(1, Math.floor((top - bottom) / rowHeight));
  const pages = Math.max(1, Math.ceil(table.rows.length / perPage));
  const left = 18;
  const usable = sheet.width - 75 - left;
  const widths = columnWidths(table, usable);

  for (let p = 0; p < pages; p++) {
    const page = newPage(doc, size);
    drawFrameAndTitleBlock(page, font, bold, size, {
      ...options.titleBlock,
      drawingTitle: `${table.name}${pages > 1 ? ` (${p + 1} of ${pages})` : ''}`,
      scaleText: 'NTS',
    });
    text(page, bold, table.name.toUpperCase(), left, sheet.height - 22, 4, INK);
    text(page, font, table.note, left, sheet.height - 27, 2.2, GREY);

    let y = top;
    let x = left;
    table.columns.forEach((c, i) => {
      text(page, bold, c, x, y, 2.4, INK);
      x += widths[i]!;
    });
    sheetLine(page, left, y - 1.2, left + usable, y - 1.2, INK, 0.25);
    y -= rowHeight;

    for (const row of table.rows.slice(p * perPage, (p + 1) * perPage)) {
      x = left;
      row.forEach((cell, i) => {
        text(page, font, truncate(String(cell), widths[i]!, 2.2), x, y, 2.2, INK);
        x += widths[i]!;
      });
      y -= rowHeight;
    }
    if (table.rows.length === 0) text(page, font, 'Nothing to report.', left, y, 2.4, GREY);
  }
}

function columnWidths(table: Table, usable: number): number[] {
  const weights = table.columns.map((c, i) => {
    const longest = Math.max(c.length, ...table.rows.map((r) => String(r[i] ?? '').length));
    return Math.min(longest, 60);
  });
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  return weights.map((w) => (w / total) * usable);
}

function truncate(value: string, widthMm: number, sizeMm: number): string {
  const perChar = sizeMm * 0.52;
  const max = Math.max(3, Math.floor(widthMm / perChar) - 1);
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function drawFrameAndTitleBlock(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  size: SheetSize,
  title: TitleBlock,
): void {
  const sheet = SHEET_SIZES[size];
  const m = 8;
  rect(page, m, m, sheet.width - 2 * m, sheet.height - 2 * m, INK, WEIGHTS.frame);

  const blockWidth = 60;
  const x = sheet.width - m - blockWidth;
  const blockHeight = 62;
  rect(page, x, m, blockWidth, blockHeight, INK, WEIGHTS.frame);

  let y = m + blockHeight - 6;
  text(page, bold, title.project, x + 2, y, 3, INK);
  y -= 4.5;
  if (title.client) {
    text(page, font, title.client, x + 2, y, 2.4, GREY);
    y -= 4;
  }
  text(page, bold, title.drawingTitle, x + 2, y, 2.8, INK);
  y -= 5;

  const field = (label: string, value: string): void => {
    text(page, font, label, x + 2, y, 2, GREY);
    text(page, font, value, x + 18, y, 2.4, INK);
    y -= 3.8;
  };
  field('DRAWING', title.drawingNumber);
  field('REVISION', title.revision);
  field('DATE', title.date);
  field('DRAWN', title.drawnBy);
  field('SCALE', title.scaleText);
  if (title.levelDatum) field('DATUM', title.levelDatum);

  y -= 1;
  sheetLine(page, x + 2, y, x + blockWidth - 2, y, LIGHT, 0.2);
  y -= 3;
  // Wrapped so the whole note is on the sheet, never clipped.
  for (const lineText of wrap(title.provenanceNote, blockWidth - 4, 1.9)) {
    text(page, font, lineText, x + 2, y, 1.9, GREY);
    y -= 2.4;
  }
}

function wrap(value: string, widthMm: number, sizeMm: number): string[] {
  const perChar = sizeMm * 0.5;
  const max = Math.max(10, Math.floor(widthMm / perChar));
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawDimension(page: PDFPage, font: PDFFont, d: Dimension, viewport: Viewport): void {
  if (d.kind === 'radial') {
    const at = toSheet(d.b, viewport);
    text(page, font, d.text, at.x, at.y, 2.2, GREY);
    return;
  }
  const u = normalise(d.direction);
  const n = perp(u);
  const off = vscale(n, d.offset);
  const a = toSheet(add(d.a, off), viewport);
  const b = toSheet(add(d.b, off), viewport);
  sheetLine(page, a.x, a.y, b.x, b.y, GREY, WEIGHTS.dim);
  const p1 = toSheet(d.a, viewport);
  const p2 = toSheet(d.b, viewport);
  sheetLine(page, p1.x, p1.y, a.x, a.y, LIGHT, WEIGHTS.dim);
  sheetLine(page, p2.x, p2.y, b.x, b.y, LIGHT, WEIGHTS.dim);
  // Text between the ticks when it fits, outside when it does not - a 150mm dimension
  // at 1:50 is 3mm on the sheet and its figure will not sit inside it.
  // A figure that will not fit between its ticks goes on a second row further out,
  // not squeezed along the line - pushing it past a tick only walks it into the
  // neighbouring figure at whichever end of the chain it happens to be.
  const drawn = Math.hypot(b.x - a.x, b.y - a.y);
  const tight = d.text.length * 1.3 > drawn;
  const stagger = tight ? vscale(n, (Math.sign(d.offset || 1) * 3) / 1) : { x: 0, y: 0 };
  const mid = { x: (a.x + b.x) / 2 + stagger.x, y: (a.y + b.y) / 2 + stagger.y };
  const degrees = ((angleOf(u) * 180) / Math.PI + 360) % 360;
  const rotate = degrees > 90 && degrees < 270 ? degrees - 180 : degrees;
  page.drawText(d.text, {
    x: mmToPt(mid.x + n.x * 1),
    y: mmToPt(mid.y + n.y * 1),
    size: mmToPt(2.2),
    font,
    color: INK,
    rotate: { type: 'degrees', angle: rotate } as never,
  });
}

// --- primitives, all in sheet millimetres ---

function text(page: PDFPage, font: PDFFont, value: string, x: number, y: number, sizeMm: number, colour: ReturnType<typeof rgb>): void {
  page.drawText(value, { x: mmToPt(x), y: mmToPt(y), size: mmToPt(sizeMm), font, color: colour });
}

function sheetLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, colour: ReturnType<typeof rgb>, weight: number): void {
  page.drawLine({
    start: { x: mmToPt(x1), y: mmToPt(y1) },
    end: { x: mmToPt(x2), y: mmToPt(y2) },
    thickness: mmToPt(weight),
    color: colour,
  });
}

function line(page: PDFPage, a: Vec2, b: Vec2, viewport: Viewport, colour: ReturnType<typeof rgb>, weight: number): void {
  const p = toSheet(a, viewport);
  const q = toSheet(b, viewport);
  sheetLine(page, p.x, p.y, q.x, q.y, colour, weight);
}

function polyline(page: PDFPage, points: readonly Vec2[], viewport: Viewport, colour: ReturnType<typeof rgb>, weight: number, closed: boolean): void {
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    line(page, points[i]!, points[(i + 1) % points.length]!, viewport, colour, weight);
  }
}

function circle(page: PDFPage, centre: Vec2, radius: number, viewport: Viewport, colour: ReturnType<typeof rgb>, weight: number): void {
  const c = toSheet(centre, viewport);
  page.drawCircle({
    x: mmToPt(c.x),
    y: mmToPt(c.y),
    size: mmToPt(Math.max(0.35, radius / viewport.scale)),
    borderColor: colour,
    borderWidth: mmToPt(weight),
  });
}

function rect(page: PDFPage, x: number, y: number, width: number, height: number, colour: ReturnType<typeof rgb>, weight: number): void {
  page.drawRectangle({
    x: mmToPt(x),
    y: mmToPt(y),
    width: mmToPt(width),
    height: mmToPt(height),
    borderColor: colour,
    borderWidth: mmToPt(weight),
  });
}
