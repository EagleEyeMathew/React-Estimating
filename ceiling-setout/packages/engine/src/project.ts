import type { Ring, Vec2, BoundaryPath } from '@ceiling/geometry';

/**
 * The project document.
 *
 * A project is a single JSON value and nothing else. It stores the rule pack version
 * each zone was generated against, so reopening a job next year regenerates the
 * drawing that was issued rather than whatever the current pack would produce.
 */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly client: string | null;
  readonly reference: string | null;
  readonly units: 'mm';
  /** Datum the levels in this project are measured from, for the title block. */
  readonly levelDatum: string | null;
  readonly structures: readonly Structure[];
  readonly zones: readonly Zone[];
  /** Manual edits, kept apart from generated geometry so regeneration cannot wipe them. */
  readonly overrides: readonly Override[];
}

/** A plane, as the project stores it. */
export type PlaneSpec =
  | { readonly kind: 'horizontal'; readonly level: number }
  | {
      readonly kind: 'raked';
      /** Level at `origin`. */
      readonly level: number;
      readonly origin: Vec2;
      /** Direction of fall in plan. */
      readonly direction: Vec2;
      /** Rise over run, e.g. 0.05 for 1:20. Positive rises along `direction`. */
      readonly fall: number;
    };

export interface ContinuousStructure {
  readonly id: string;
  readonly name: string;
  /** A continuous soffit - a hanger may be fixed anywhere. */
  readonly kind: 'slab' | 'existing_ceiling';
  readonly plane: PlaneSpec;
}

export interface DiscreteStructure {
  readonly id: string;
  readonly name: string;
  /** Discrete members - a hanger may only be fixed where one runs. */
  readonly kind: 'purlins' | 'joists';
  readonly plane: PlaneSpec;
  readonly direction: Vec2;
  readonly spacing: number;
  /** Perpendicular offset of the first member from the world origin, mm. */
  readonly offset: number;
  /** Width of the member's fixable face, mm. */
  readonly width: number;
}

/**
 * What is above the ceiling, and therefore where a hanger may be fixed.
 *
 * A hanger that floats in air between two purlins is the defect this exists to
 * prevent, so the structure is modelled explicitly rather than assumed continuous.
 */
export type Structure = ContinuousStructure | DiscreteStructure;

export const isDiscreteStructure = (s: Structure): s is DiscreteStructure =>
  s.kind === 'purlins' || s.kind === 'joists';

/** Singular noun for messages: "no purlin crosses this member". */
export const structureMemberNoun = (s: Structure): string =>
  s.kind === 'purlins' ? 'purlin' : s.kind === 'joists' ? 'joist' : s.kind === 'slab' ? 'slab' : 'existing ceiling';

export type PenetrationKind =
  | 'downlight'
  | 'diffuser'
  | 'sprinkler'
  | 'speaker'
  | 'access_panel'
  | 'smoke_detector'
  | 'other';

export type PenetrationShape =
  | { readonly kind: 'circle'; readonly centre: Vec2; readonly radius: number }
  | {
      readonly kind: 'rect';
      readonly centre: Vec2;
      readonly width: number;
      readonly height: number;
      /** Plan rotation in radians. */
      readonly rotation: number;
    };

export interface Penetration {
  readonly id: string;
  readonly kind: PenetrationKind;
  readonly reference: string | null;
  readonly shape: PenetrationShape;
}

/** How the setout direction is chosen. */
export type DirectionSpec =
  | { readonly kind: 'longest-edge' }
  | { readonly kind: 'principal-axis' }
  | { readonly kind: 'angle'; readonly degrees: number }
  | { readonly kind: 'vector'; readonly vector: Vec2 };

/** How the setout lattice is positioned. */
export type OriginSpec =
  /** Equal cuts against opposite walls. What a setter-out does by hand. */
  | { readonly kind: 'balanced' }
  /** Anchored on the boundary vertex nearest the world origin. */
  | { readonly kind: 'datum-corner' }
  | { readonly kind: 'point'; readonly point: Vec2 };

export interface ZoneSetout {
  readonly direction: DirectionSpec;
  readonly origin: OriginSpec;
  /**
   * Nudge the primary lattice to keep members clear of small penetrations, within the
   * setback rule. A drafter does this by eye; doing it here is deterministic and
   * reported. Turn it off to hold an exact setout.
   */
  readonly avoidPenetrations: boolean;
}

export interface Zone {
  readonly id: string;
  readonly name: string;
  /** Outer boundary. Arcs are kept as arcs and tessellated only for generation. */
  readonly boundary: BoundaryPath;
  /** Columns, voids, stair openings - subtracted from the boundary. */
  readonly holes: readonly Ring[];
  readonly penetrations: readonly Penetration[];
  /** Finished ceiling level and its rake. */
  readonly plane: PlaneSpec;
  readonly structureId: string;
  /** How far a hanger may be moved to land on structure, mm. */
  readonly structureSnapTolerance: number;
  readonly system: {
    readonly pack: string;
    readonly version: string;
    readonly loadCase: string | null;
  };
  readonly setout: ZoneSetout;
  /** Layers switched off for this zone only, by layer id. */
  readonly disabledLayers: readonly string[];
}

/**
 * A manual edit, stored against a stable member identity rather than an array index.
 *
 * Regeneration rebuilds every member from scratch, so an override has to be able to
 * find its member again afterwards. Identities come from the setout lattice, not from
 * generation order, so editing one end of a room leaves the identities at the other
 * end alone. An override whose member no longer exists is reported, never dropped
 * silently - the user needs to know their edit went nowhere.
 */
export type Override =
  | { readonly kind: 'delete'; readonly memberId: string; readonly note: string | null }
  | { readonly kind: 'move'; readonly memberId: string; readonly delta: Vec2; readonly note: string | null }
  | {
      readonly kind: 'retrim';
      readonly memberId: string;
      /** Trim from the start and end of the member, mm. */
      readonly trimStart: number;
      readonly trimEnd: number;
      readonly note: string | null;
    }
  | { readonly kind: 'product'; readonly memberId: string; readonly productCode: string; readonly note: string | null };

export const horizontal = (level: number): PlaneSpec => ({ kind: 'horizontal', level });
