import type { Vec2 } from '@ceiling/geometry';

/** Sheet sizes in millimetres, landscape. */
export const SHEET_SIZES = {
  A4: { width: 297, height: 210 },
  A3: { width: 420, height: 297 },
  A2: { width: 594, height: 420 },
  A1: { width: 841, height: 594 },
  A0: { width: 1189, height: 841 },
} as const;

export type SheetSize = keyof typeof SHEET_SIZES;

/** Scales a drafter would actually put on a ceiling plan. */
export const PREFERRED_SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500] as const;

export interface TitleBlock {
  readonly project: string;
  readonly client: string | null;
  readonly drawingTitle: string;
  readonly drawingNumber: string;
  readonly revision: string;
  readonly date: string;
  readonly drawnBy: string;
  readonly scaleText: string;
  readonly levelDatum: string | null;
  /** The standing of the numbers behind the drawing. Never omitted. */
  readonly provenanceNote: string;
}

export interface Viewport {
  /** Drawing units per sheet millimetre, e.g. 50 for 1:50. */
  readonly scale: number;
  /** Sheet-space position of the model origin, in mm from the sheet's bottom-left. */
  readonly offset: Vec2;
  readonly frame: { x: number; y: number; width: number; height: number };
}

/**
 * Fit a model extent onto a sheet at a scale a drafter would use.
 *
 * A plan at 1:47 is not a drawing anyone can scale off, so the fit rounds out to the
 * next preferred scale rather than filling the paper exactly.
 */
export function fitViewport(
  modelMin: Vec2,
  modelMax: Vec2,
  size: SheetSize,
  margins: { left: number; right: number; top: number; bottom: number } = { left: 15, right: 70, top: 15, bottom: 15 },
): Viewport {
  const sheet = SHEET_SIZES[size];
  const frame = {
    x: margins.left,
    y: margins.bottom,
    width: sheet.width - margins.left - margins.right,
    height: sheet.height - margins.top - margins.bottom,
  };
  const modelWidth = Math.max(1, modelMax.x - modelMin.x);
  const modelHeight = Math.max(1, modelMax.y - modelMin.y);
  const needed = Math.max(modelWidth / frame.width, modelHeight / frame.height);
  const scale = PREFERRED_SCALES.find((s) => s >= needed) ?? Math.ceil(needed / 100) * 100;

  // Centre what is left over, so the plan sits in the middle of the frame.
  const drawnWidth = modelWidth / scale;
  const drawnHeight = modelHeight / scale;
  const offset = {
    x: frame.x + (frame.width - drawnWidth) / 2 - modelMin.x / scale,
    y: frame.y + (frame.height - drawnHeight) / 2 - modelMin.y / scale,
  };
  return { scale, offset, frame };
}

/** Model point to sheet point, in millimetres from the sheet's bottom-left. */
export const toSheet = (p: Vec2, viewport: Viewport): Vec2 => ({
  x: viewport.offset.x + p.x / viewport.scale,
  y: viewport.offset.y + p.y / viewport.scale,
});

export const scaleText = (scale: number): string => `1:${Math.round(scale)}`;

/** Millimetres to PDF points. */
export const mmToPt = (mm: number): number => (mm * 72) / 25.4;
