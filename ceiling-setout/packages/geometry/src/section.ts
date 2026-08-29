import type { MultiPolygon, Ring, Vec2 } from './types.js';
import { thickenOpenPath } from './clipper.js';
import { multiPolygonArea, normalisePolygon } from './polygon.js';
import { bbox, isSimple } from './ring.js';
import { EPS, quantise } from './num.js';

/**
 * The cross-section of a member, as the rule pack stores it.
 *
 * A section is a manufacturer figure like any other, so it lives in the pack and never
 * in code. The origin of a section's coordinates is the member's setout line: x runs
 * across the member, y runs up. That way the pack author decides where the line sits
 * in the section - along the crown of a furring channel, along the top of a rail - and
 * nothing downstream has to guess.
 */
export type SectionProfile =
  /**
   * A folded sheet: the line the metal follows, plus its gauge. Channels, top hats,
   * angles and tees are all this, and it is how they are drawn and rolled.
   */
  | { readonly kind: 'sheet'; readonly spine: readonly (readonly [number, number])[]; readonly thickness: number }
  /** A solid extrusion given by its outline. */
  | { readonly kind: 'solid'; readonly outline: readonly (readonly [number, number])[] }
  /** A round bar or wire. */
  | { readonly kind: 'round'; readonly diameter: number };

export interface SectionOutline {
  /** Closed rings making up the section. More than one for a section with a void. */
  readonly rings: readonly Ring[];
  /** Overall width across the member, mm. */
  readonly width: number;
  /** Overall depth of the section, mm. */
  readonly depth: number;
  /** Cross-sectional area, mm2. Multiplied by density this gives mass per metre. */
  readonly area: number;
}

const ROUND_SEGMENTS = 16;

/**
 * Resolve a profile into closed rings ready to extrude.
 *
 * Returns null for a profile that cannot be drawn - too few points, no gauge, a spine
 * that crosses itself - because a section that renders as garbage is worse than one
 * that renders as a plain bar with a note saying the profile has not been entered.
 */
export function sectionOutline(profile: SectionProfile): SectionOutline | null {
  switch (profile.kind) {
    case 'round': {
      if (!(profile.diameter > 0)) return null;
      const r = profile.diameter / 2;
      const ring: Vec2[] = [];
      for (let i = 0; i < ROUND_SEGMENTS; i++) {
        const t = (2 * Math.PI * i) / ROUND_SEGMENTS;
        ring.push({ x: quantise(r * Math.cos(t)), y: quantise(r * Math.sin(t)) });
      }
      return measure([ring]);
    }
    case 'solid': {
      const ring = profile.outline.map(([x, y]) => ({ x, y }));
      if (ring.length < 3 || !isSimple(ring)) return null;
      return measure([ring]);
    }
    case 'sheet': {
      if (profile.spine.length < 2 || !(profile.thickness > 0)) return null;
      const spine = profile.spine.map(([x, y]) => ({ x, y }));
      const thickened = thickenOpenPath(spine, profile.thickness);
      if (thickened.length === 0) return null;
      return measure(ringsOf(thickened));
    }
  }
}

function ringsOf(mp: MultiPolygon): Ring[] {
  const out: Ring[] = [];
  for (const poly of mp) {
    out.push(poly.outer);
    for (const hole of poly.holes) out.push(hole);
  }
  return out;
}

function measure(rings: readonly Ring[]): SectionOutline | null {
  const points = rings.flat();
  if (points.length < 3) return null;
  const box = bbox(points);
  const area = multiPolygonArea(rings.map((r) => normalisePolygon({ outer: r, holes: [] })));
  if (area <= EPS) return null;
  return {
    rings,
    width: quantise(box.maxX - box.minX),
    depth: quantise(box.maxY - box.minY),
    area: quantise(area),
  };
}

/**
 * The plain rectangle a member falls back to when its section has not been drawn but
 * its overall size has been entered. Honest about what is known: the right size, and
 * explicitly not the right shape.
 */
export function boundingSection(width: number, depth: number): SectionProfile {
  const w = width / 2;
  return {
    kind: 'solid',
    outline: [
      [-w, 0],
      [w, 0],
      [w, depth],
      [-w, depth],
    ],
  };
}
