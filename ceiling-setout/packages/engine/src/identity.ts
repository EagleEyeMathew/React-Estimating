/**
 * Member identities.
 *
 * An identity has to survive a regeneration, because that is what user overrides are
 * keyed on. So it is built from where a member sits in the setout lattice, never from
 * its position in an array: adding a penetration at one end of a room must not
 * renumber the members at the other end.
 */

const part = (v: string | number): string => String(v).replace(/[:|]/g, '_');

/** A member from a line array, located by its signed lattice index and piece. */
export const lineMemberId = (zoneId: string, layerId: string, lineIndex: number, segmentIndex: number): string =>
  `${part(zoneId)}:${part(layerId)}:L${lineIndex}.${segmentIndex}`;

/**
 * A member on a line added to satisfy a perimeter setback rather than by the lattice.
 * Keyed on its offset, quantised to the millimetre, so it is stable as long as the
 * wall it answers to has not moved.
 */
export const edgeMemberId = (zoneId: string, layerId: string, offset: number, segmentIndex: number): string =>
  `${part(zoneId)}:${part(layerId)}:E${Math.round(offset)}.${segmentIndex}`;

/** A piece of a member cut at a crossing, e.g. a cross tee between two main tees. */
export const splitMemberId = (baseId: string, pieceIndex: number): string => `${baseId}/p${pieceIndex}`;

/** A point on a host member, keyed on its distance along that member. */
export const alongMemberId = (layerId: string, hostId: string, distanceAlong: number): string =>
  `${part(hostId)}>${part(layerId)}@${Math.round(distanceAlong)}`;

/** A run of perimeter trim along one boundary edge. */
export const perimeterMemberId = (zoneId: string, layerId: string, ringIndex: number, edgeIndex: number): string =>
  `${part(zoneId)}:${part(layerId)}:R${ringIndex}.${edgeIndex}`;

/** A trimmer around a penetration. */
export const trimmerMemberId = (zoneId: string, layerId: string, penetrationId: string, side: string): string =>
  `${part(zoneId)}:${part(layerId)}:T${part(penetrationId)}.${side}`;

/** A bridging member added where a hanger had no structure to fix to. */
export const bridgingMemberId = (zoneId: string, hangerId: string): string =>
  `${part(zoneId)}:bridging:${part(hangerId)}`;

/** A brace at a point on the bracing grid. */
export const braceMemberId = (zoneId: string, layerId: string, i: number, j: number): string =>
  `${part(zoneId)}:${part(layerId)}:B${i}.${j}`;
