import type { MultiPolygon, Segment, Vec2 } from './types.js';
import { multiPolygonBBox, multiPolygonArea } from './polygon.js';
import { distanceToNearestSegment, pointInMultiPolygon } from './predicates.js';

export interface CoverageResult {
  /** Worst distance from a sampled interior point to the nearest member. */
  readonly maxDistance: number;
  /** Where that worst case is, for reporting back to the user. */
  readonly worstPoint: Vec2 | null;
  readonly samples: number;
}

/**
 * Worst-case distance from anywhere in the region to the nearest supporting member.
 *
 * Sampled rather than exact. It backs the property tests ("no part of the ceiling is
 * further than X from a support") and the validator's unsupported-area check, where
 * a dense sample is a sound proxy and an exact medial-axis computation would not
 * earn its complexity.
 */
export function coverage(
  region: MultiPolygon,
  members: readonly Segment[],
  sampleSpacing = 100,
): CoverageResult {
  if (region.length === 0 || multiPolygonArea(region) <= 0) {
    return { maxDistance: 0, worstPoint: null, samples: 0 };
  }
  if (members.length === 0) {
    return { maxDistance: Infinity, worstPoint: null, samples: 0 };
  }
  const box = multiPolygonBBox(region);
  const nx = Math.max(1, Math.ceil((box.maxX - box.minX) / sampleSpacing));
  const ny = Math.max(1, Math.ceil((box.maxY - box.minY) / sampleSpacing));
  let maxDistance = 0;
  let worstPoint: Vec2 | null = null;
  let samples = 0;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const p = {
        x: box.minX + ((box.maxX - box.minX) * i) / nx,
        y: box.minY + ((box.maxY - box.minY) * j) / ny,
      };
      if (pointInMultiPolygon(p, region) !== 'inside') continue;
      samples++;
      const d = distanceToNearestSegment(p, members);
      if (d > maxDistance) {
        maxDistance = d;
        worstPoint = p;
      }
    }
  }
  return { maxDistance, worstPoint, samples };
}
