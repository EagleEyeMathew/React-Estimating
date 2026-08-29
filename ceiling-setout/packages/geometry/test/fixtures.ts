import { mulberry32 } from '../src/rng.js';
import { circle, normalisePolygon, rectangle } from '../src/polygon.js';
import { distanceToBoundary } from '../src/predicates.js';
import type { Polygon, Ring, Vec2 } from '../src/types.js';
import { dist } from '../src/vec.js';

/**
 * A random star-shaped polygon: monotonically increasing vertex angles with random
 * radii. Simple by construction, and genuinely concave - deep notches are what break
 * naive line-array code.
 */
export function randomConcaveRing(rand: () => number, minR = 4000, maxR = 14000): Ring {
  const n = 6 + Math.floor(rand() * 9);
  const base = minR + rand() * (maxR - minR);
  const pts: Vec2[] = [];
  // Random but strictly increasing angles keep the ring simple.
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(rand());
  const total = angles.reduce((s, a) => s + a + 0.35, 0);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (angles[i]! + 0.35) / total;
    const t = 2 * Math.PI * acc + rand() * 0.001;
    const r = base * (0.25 + rand() * 0.75);
    pts.push({ x: Math.round(r * Math.cos(t)), y: Math.round(r * Math.sin(t)) });
  }
  return pts;
}

/** Circular holes placed fully inside the ring and clear of each other. */
export function randomHoles(rand: () => number, outer: Ring, maxHoles = 3): Ring[] {
  const region = [normalisePolygon({ outer, holes: [] })];
  const holes: Ring[] = [];
  const centres: { c: Vec2; r: number }[] = [];
  const count = Math.floor(rand() * (maxHoles + 1));
  let attempts = 0;
  while (holes.length < count && attempts < 200) {
    attempts++;
    const r = 300 + rand() * 700;
    const c = { x: (rand() - 0.5) * 20000, y: (rand() - 0.5) * 20000 };
    if (distanceToBoundary(c, region) < r + 400) continue;
    if (!isInside(c, outer)) continue;
    if (centres.some((o) => dist(o.c, c) < o.r + r + 500)) continue;
    centres.push({ c, r });
    holes.push(circle(c, r, 16));
  }
  return holes;
}

function isInside(p: Vec2, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const t = (p.y - a.y) / (b.y - a.y);
      if (p.x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}

export function randomPolygon(seed: number): Polygon {
  const rand = mulberry32(seed);
  const outer = randomConcaveRing(rand);
  return normalisePolygon({ outer, holes: randomHoles(rand, outer) });
}

/** The L-shaped reference room used across the test suite (mm). */
export const L_ROOM: Ring = [
  { x: 0, y: 0 },
  { x: 8000, y: 0 },
  { x: 8000, y: 4000 },
  { x: 4000, y: 4000 },
  { x: 4000, y: 9000 },
  { x: 0, y: 9000 },
];

export const SQUARE_ROOM: Ring = rectangle(0, 0, 6000, 6000);
