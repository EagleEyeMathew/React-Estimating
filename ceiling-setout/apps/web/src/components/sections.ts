import * as THREE from 'three';
import { boundingSection, sectionOutline, type SectionProfile } from '@ceiling/geometry';
import type { Component, Product } from '@ceiling/rules';

/**
 * Turning a product's section into geometry.
 *
 * The section itself comes from the rule pack - it is a manufacturer figure like a
 * spacing and belongs nowhere else. This module only does the drawing: a closed
 * outline becomes a Shape, the Shape is extruded one unit along +Z, and the member
 * scales it to its own length. One geometry per product rather than one per member
 * keeps a room of four hundred members cheap.
 */

/** How the section was arrived at, so the model can say when it is not the real shape. */
export type SectionSource = 'profile' | 'bounding-box' | 'nominal';

export interface MemberGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly source: SectionSource;
  readonly width: number;
  readonly depth: number;
}

// Model units are metres; the packs are in millimetres.
const S = 0.001;

/** Last-resort size for a product with neither a section nor an overall size entered. */
const NOMINAL: Record<string, [number, number]> = {
  hanger: [6, 6],
  bridging: [50, 50],
  brace: [20, 20],
};
const NOMINAL_DEFAULT: [number, number] = [30, 30];

const cache = new Map<string, MemberGeometry>();

/**
 * The geometry for a member type built from a product.
 *
 * Falls back in two steps, and each step is honest about what it is: the drawn
 * section, then the overall size as a plain rectangle, then a nominal bar. The caller
 * shows which, because a bar that is the right size and the wrong shape must not read
 * as the product.
 */
export function memberGeometry(product: Product | null, memberType: string): MemberGeometry {
  const key = `${product?.code ?? '-'}|${memberType}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let profile: SectionProfile | null = product?.profile ?? null;
  let source: SectionSource = 'profile';

  if (!profile && product?.width && product?.depth) {
    profile = boundingSection(product.width, product.depth);
    source = 'bounding-box';
  }
  if (!profile) {
    const [w, d] = NOMINAL[memberType] ?? NOMINAL_DEFAULT;
    profile = boundingSection(w, d);
    source = 'nominal';
  }

  const outline = sectionOutline(profile) ?? sectionOutline(boundingSection(...NOMINAL_DEFAULT))!;
  const built: MemberGeometry = {
    geometry: extrude(outline.rings),
    source,
    width: outline.width,
    depth: outline.depth,
  };
  cache.set(key, built);
  return built;
}

/**
 * Extrude the section one unit along +Z.
 *
 * Rings after the first are treated as voids: a rolled section can enclose one, and
 * filling it in would make a hollow member look solid.
 */
function extrude(rings: readonly (readonly { x: number; y: number }[])[]): THREE.BufferGeometry {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 3) return new THREE.BoxGeometry(0.03, 0.03, 1);
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x * S, p.y * S)));
  for (const hole of holes) {
    if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x * S, p.y * S))));
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 4 });
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Orientation that runs the section's +Z along the member while keeping its +Y up.
 *
 * A hanger runs straight up, where "keep Y up" has no answer, so the section is rolled
 * about the world X axis instead - a rod looks the same either way, and a bracket at
 * least stays square to the room.
 */
export function orientAlong(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const dir = to.clone().sub(from);
  if (dir.lengthSq() < 1e-12) return new THREE.Quaternion();
  dir.normalize();
  const up = Math.abs(dir.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const zAxis = dir;
  const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
}

export interface ComponentPartGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly position: [number, number, number];
  readonly quaternion: THREE.Quaternion;
}

const componentCache = new Map<string, ComponentPartGeometry[]>();

/**
 * A piece of point hardware as its parts.
 *
 * A clip drawn as five folded plates reads as a clip; the same clip drawn as a cube
 * reads as a placeholder, and a drafter checking a model needs to be able to tell the
 * difference at a glance.
 */
export function componentGeometry(code: string, component: Component): ComponentPartGeometry[] {
  const hit = componentCache.get(code);
  if (hit) return hit;

  const parts = component.parts.map((part): ComponentPartGeometry => {
    if (part.shape === 'box') {
      const [w, h, l] = part.size;
      return {
        geometry: new THREE.BoxGeometry(w * S, h * S, l * S),
        position: [part.at[0] * S, part.at[1] * S, part.at[2] * S],
        quaternion: new THREE.Quaternion(),
      };
    }
    const geometry = new THREE.CylinderGeometry((part.diameter / 2) * S, (part.diameter / 2) * S, part.length * S, 10);
    // Cylinders are built along +Y; turn them to the axis the pack asked for.
    const q = new THREE.Quaternion();
    if (part.axis === 'across') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    else if (part.axis === 'along') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    return {
      geometry,
      position: [part.at[0] * S, part.at[1] * S, part.at[2] * S],
      quaternion: q,
    };
  });

  componentCache.set(code, parts);
  return parts;
}

/** Cleared when the packs change, so an edited section is redrawn rather than cached. */
export function clearGeometryCache(): void {
  for (const g of cache.values()) g.geometry.dispose();
  cache.clear();
  for (const parts of componentCache.values()) for (const p of parts) p.geometry.dispose();
  componentCache.clear();
}
