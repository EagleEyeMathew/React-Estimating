import type { MultiPolygon, Plane, Vec2, Vec3 } from '@ceiling/geometry';
import type { MemberType, RulePack } from '@ceiling/rules';

/**
 * Why a member is where it is.
 *
 * This is what makes the output defensible. A builder or engineer asking "why is that
 * TSR at 900 and not 1200" gets the value path that governed, everything else that
 * was weighed, and the pack version it all came from - not an assurance.
 */
export interface Provenance {
  /** Dotted value path of the constraint that decided this member's position. */
  readonly ruleId: string;
  /** `system@version` of the pack. */
  readonly rulePackVersion: string;
  /** One sentence a person can read. */
  readonly reason: string;
  readonly spacingUsed: number | null;
  readonly spanUsed: number | null;
  /** Every constraint considered, whether or not it bound. */
  readonly constraints: readonly { readonly path: string; readonly value: number }[];
  /** Where the governing figure was said to come from. */
  readonly citation: string | null;
}

export interface FixingSpec {
  readonly type: string | null;
  readonly substrate: string | null;
  readonly count: number;
  readonly productCode: string | null;
  readonly at: Vec3;
}

export interface Member {
  /**
   * Stable identity, derived from the setout lattice rather than generation order, so
   * that an override survives a regeneration. Format:
   * `zone:layer:<lattice locator>`.
   */
  readonly id: string;
  readonly type: MemberType;
  readonly layerId: string;
  readonly productCode: string | null;
  readonly start: Vec3;
  readonly end: Vec3;
  /** True length on the ceiling plane - the length it is cut to. */
  readonly length: number;
  /** Length in plan. Differs from `length` on a rake. */
  readonly planLength: number;
  /** Plan rotation in radians, measured CCW from +X. */
  readonly rotation: number;
  readonly fixings: readonly FixingSpec[];
  readonly connectsTo: readonly string[];
  readonly zoneId: string;
  readonly provenance: Provenance;
  /** Set when a manual override changed this member. */
  readonly overridden?: 'moved' | 'retrimmed' | 'product';
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  readonly id: string;
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly zoneId: string | null;
  readonly location: Vec3 | Vec2 | null;
  readonly memberIds: readonly string[];
  /** Value path this issue is about, where there is one. */
  readonly ruleId: string | null;
}

export interface SetoutDecision {
  readonly direction: Vec2;
  readonly directionDegrees: number;
  readonly directionReason: string;
  readonly origin: Vec2;
  readonly originReason: string;
  /** Lattice origin actually used per layer, after balancing and any nudge. */
  readonly layerOrigins: Readonly<Record<string, Vec2>>;
}

export interface ZoneResult {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly region: MultiPolygon;
  /** Region with trimmed openings removed - what the members were clipped to. */
  readonly buildableRegion: MultiPolygon;
  readonly plane: Plane;
  readonly structurePlane: Plane;
  readonly setout: SetoutDecision;
  readonly members: readonly Member[];
  readonly issues: readonly Issue[];
  readonly packKey: string;
  readonly loadCaseId: string | null;
  /** Spacing actually used per layer, with the constraint that set it. */
  readonly spacings: Readonly<Record<string, { spacing: number | null; governedBy: string | null }>>;
}

export interface GenerationResult {
  readonly projectId: string;
  readonly projectName: string;
  readonly zones: readonly ZoneResult[];
  readonly members: readonly Member[];
  readonly issues: readonly Issue[];
  /** The standing on the numbers behind every drawing generated from this run. */
  readonly banners: readonly string[];
  readonly packKeys: readonly string[];
  /** Overrides that no longer match any member, so the user can see their edit was lost. */
  readonly orphanedOverrides: readonly string[];
}

export interface GenerationContext {
  readonly pack: RulePack;
  readonly packKey: string;
}
