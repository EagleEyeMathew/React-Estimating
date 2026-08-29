import { z } from 'zod';

/**
 * Rule pack schema.
 *
 * Two rules govern everything here.
 *
 * First, every manufacturer figure is data, never code. A pack is the only place a
 * spacing, a span or a product code may appear, so adding a ceiling system is a data
 * task: write a pack, and the engine generates it.
 *
 * Second, an un-entered figure is `null`, and null is not a default. A skeleton pack
 * ships with nulls throughout; the engine refuses to generate the affected layer and
 * raises an issue naming the value. Guessing a span figure would produce a drawing
 * that looks authoritative and is not, which is the worst thing this app could do.
 */

/** A value the user has still to enter from the manufacturer literature. */
const entered = () => z.number().finite().nullable();
const enteredPositive = () => z.number().finite().positive().nullable();
const enteredNonNegative = () => z.number().finite().nonnegative().nullable();

export const memberTypeSchema = z.enum([
  'hanger',
  'tsr',
  'furring',
  'main_tee',
  'cross_tee',
  'bracket',
  'rail',
  'trim',
  'batten',
  'brace',
  /** A member added to span between structural supports where a hanger has nothing to fix to. */
  'bridging',
]);
export type MemberType = z.infer<typeof memberTypeSchema>;

/**
 * How confident the app may be about the numbers in this pack. Carried through to
 * every drawing and schedule, because a reader has to be able to tell entered
 * figures from placeholder ones at a glance.
 */
export const packStatusSchema = z.enum([
  /** Shipped shape, values still null. Generates nothing until filled in. */
  'skeleton',
  /** Values typed in by a user from the literature, not yet checked by a second pair of eyes. */
  'user-entered',
  /** Values checked against the cited document by a named person. */
  'verified',
  /** Fictitious values for tests and demos. Never valid for a real project. */
  'example',
]);
export type PackStatus = z.infer<typeof packStatusSchema>;

export const citationSchema = z.object({
  /** The document the figure came from. */
  source: z.string().min(1),
  /** Table, clause or page reference within it. */
  reference: z.string().nullable().default(null),
  /** Revision or edition of the document. */
  revision: z.string().nullable().default(null),
  /** ISO date of that revision. */
  date: z.string().nullable().default(null),
  enteredBy: z.string().nullable().default(null),
  enteredAt: z.string().nullable().default(null),
});
export type Citation = z.infer<typeof citationSchema>;

export const productSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  /**
   * What the product may be used as. A list rather than one value: a channel section
   * is routinely both a furring channel and a top cross rail, and forcing a single
   * role would mean cataloguing the same product twice.
   */
  roles: z.array(memberTypeSchema).min(1),
  /** Stock lengths the product is supplied in, mm. Drives cut optimisation. */
  stockLengths: z.array(z.number().positive()).nullable().default(null),
  /** Self weight, kg/m. */
  massPerMetre: enteredPositive().default(null),
  /** Section depth and width, mm. Used for the 3D model and for build-up heights. */
  depth: enteredPositive().default(null),
  width: enteredPositive().default(null),
  /** Pack quantity for ordering. */
  packQuantity: z.number().int().positive().nullable().default(null),
});
export type Product = z.infer<typeof productSchema>;

/** Per-layer spacing and span limits under a given lining load. */
export const layerLimitSchema = z.object({
  layerId: z.string().min(1),
  /** Maximum centre-to-centre spacing of this layer, mm. */
  maxSpacing: enteredPositive().default(null),
  /** Maximum unsupported span of a member of this layer, mm. */
  maxSpan: enteredPositive().default(null),
});
export type LayerLimit = z.infer<typeof layerLimitSchema>;

export const loadCaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  /** What is hung off the system - lining, insulation, services. */
  lining: z.string().nullable().default(null),
  /** Design load, kg/m2. */
  massPerSquareMetre: enteredPositive().default(null),
  limits: z.array(layerLimitSchema).default([]),
});
export type LoadCase = z.infer<typeof loadCaseSchema>;

export const fixingSchema = z.object({
  type: z.string().nullable().default(null),
  substrate: z.string().nullable().default(null),
  countPerConnection: z.number().int().positive().nullable().default(null),
  productCode: z.string().nullable().default(null),
});
export type Fixing = z.infer<typeof fixingSchema>;

const layerBase = {
  id: z.string().min(1),
  description: z.string().min(1),
  memberType: memberTypeSchema,
  /** Catalogue code this layer is built from. */
  product: z.string().nullable().default(null),
  /** Alternative catalogue codes the user may swap to. */
  alternativeProducts: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  fixings: fixingSchema.default({}),
  /** Vertical offset of this layer's underside above the finished ceiling level, mm. */
  heightAboveFcl: enteredNonNegative().default(null),
};

/**
 * A family of parallel members clipped to the zone. Primary layers run along the
 * setout direction; secondary layers run across it.
 */
export const lineArrayLayerSchema = z.object({
  ...layerBase,
  generator: z.literal('line-array'),
  orientation: z.enum(['primary', 'secondary']),
  /** Maximum centre-to-centre spacing, mm. Overridden by the load case if that is tighter. */
  maxSpacing: enteredPositive().default(null),
  /**
   * Fixed module, mm. Set for tile grids and exposed battens, where the spacing is
   * the visible module and must not be reduced to suit a span - null otherwise.
   */
  module: enteredPositive().default(null),
  /** Maximum distance from a wall to the first member, mm. */
  maxFromWall: enteredNonNegative().default(null),
  /** Pieces shorter than this are unusable and get flagged rather than drawn. */
  minSegmentLength: enteredPositive().default(null),
  /** Layer this one bears on. Its span limit caps that layer's spacing. */
  supportedBy: z.string().nullable().default(null),
  /** Where the two ends of a member land relative to its supports. */
  maxEndOverhang: enteredNonNegative().default(null),
  /**
   * Cut this layer's members at every crossing with the named layer, rather than
   * running them through. Exposed grid cross tees are supplied as modular pieces
   * between main tees, not as continuous lengths.
   */
  splitAtCrossingsWith: z.string().nullable().default(null),
});
export type LineArrayLayer = z.infer<typeof lineArrayLayerSchema>;

/** Points distributed along the members of another layer - hangers, brackets, clips. */
export const alongMemberLayerSchema = z.object({
  ...layerBase,
  generator: z.literal('along-member'),
  /** Layer whose members carry this one. */
  along: z.string().min(1),
  /** Maximum spacing along the host member, mm. */
  maxSpacing: enteredPositive().default(null),
  /** Maximum distance from a free end of the host member to the first point, mm. */
  firstFromEnd: enteredNonNegative().default(null),
  /** Also place one at every crossing with this layer, if set. */
  atCrossingsWith: z.string().nullable().default(null),
});
export type AlongMemberLayer = z.infer<typeof alongMemberLayerSchema>;

/** Trim following the zone boundary - wall angle, shadowline, edge channel. */
export const perimeterLayerSchema = z.object({
  ...layerBase,
  generator: z.literal('perimeter'),
  /** Corner treatment for cut lengths. */
  cornerTreatment: z.enum(['mitre', 'butt', 'lap']).default('mitre'),
  /** Fixing centres along the wall, mm. */
  fixingCentres: enteredPositive().default(null),
  /** Maximum distance from a corner to the first fixing, mm. */
  firstFixingFromCorner: enteredNonNegative().default(null),
  /** Follow hole edges as well as the outer boundary. */
  followHoles: z.boolean().default(true),
});
export type PerimeterLayer = z.infer<typeof perimeterLayerSchema>;

/** Lateral or seismic restraint. */
export const braceLayerSchema = z.object({
  ...layerBase,
  generator: z.literal('brace'),
  /** Grid spacing of brace points, mm. */
  gridSpacing: enteredPositive().default(null),
  /** Maximum distance from a wall to the first brace, mm. */
  maxFromWall: enteredNonNegative().default(null),
  /** Angle from vertical, degrees. */
  angleFromVertical: enteredPositive().default(null),
  /** Only brace where the drop exceeds this, mm. */
  minDropToRequire: enteredPositive().default(null),
});
export type BraceLayer = z.infer<typeof braceLayerSchema>;

export const layerSchema = z.discriminatedUnion('generator', [
  lineArrayLayerSchema,
  alongMemberLayerSchema,
  perimeterLayerSchema,
  braceLayerSchema,
]);
export type Layer = z.infer<typeof layerSchema>;

export const penetrationRuleSchema = z.object({
  /** Penetrations larger than this get trimmed, mm2. Smaller ones are cut around only. */
  trimAboveArea: enteredPositive().default(null),
  /** Penetrations wider than this across the primary members get trimmed regardless, mm. */
  trimAboveWidth: enteredPositive().default(null),
  /** Clearance added around the opening before trimmers are set out, mm. */
  clearance: enteredNonNegative().default(null),
  /** Layer the trimmers are made from. */
  trimmerLayer: z.string().nullable().default(null),
  /** Double the trimmer where the opening exceeds this width, mm. */
  doubleAboveWidth: enteredPositive().default(null),
  /** Add a hanger at each trimmer end. */
  hangerAtTrimmerEnds: z.boolean().default(true),
  /** Keep penetrations at least this far off a member centreline, mm. */
  minClearOfMember: enteredNonNegative().default(null),
});
export type PenetrationRule = z.infer<typeof penetrationRuleSchema>;

export const buildUpSchema = z.object({
  /** Lining thickness below the framing, mm. */
  liningThickness: enteredNonNegative().default(null),
  /** Total system depth from finished ceiling level to the top of the topmost member, mm. */
  systemDepth: enteredNonNegative().default(null),
  /** Shortest drop a hanger may be cut to, mm. */
  minHangerDrop: enteredNonNegative().default(null),
  /** Longest drop before the pack requires a braced or alternative solution, mm. */
  maxHangerDrop: enteredPositive().default(null),
});
export type BuildUp = z.infer<typeof buildUpSchema>;

export const optimisationSchema = z.object({
  /** Stock lengths available for cutting, mm. Falls back to the product's own list. */
  stockLengths: z.array(z.number().positive()).nullable().default(null),
  /** Saw kerf, mm. */
  kerf: enteredNonNegative().default(null),
  /** Offcuts shorter than this are waste rather than stock, mm. */
  minReusableOffcut: enteredPositive().default(null),
});
export type Optimisation = z.infer<typeof optimisationSchema>;

export const rulePackSchema = z.object({
  /** Stable slug. Projects reference a pack by system + version. */
  system: z.string().min(1).regex(/^[a-z0-9_]+$/, 'system must be a lowercase slug'),
  name: z.string().min(1),
  version: z.string().min(1),
  status: packStatusSchema,
  units: z.literal('mm'),
  manufacturer: z.string().nullable().default(null),
  /** Where the pack as a whole came from. Per-value citations live in `citations`. */
  source: citationSchema,
  /** Anything the user needs to know before trusting the output. */
  notes: z.string().nullable().default(null),
  catalogue: z.array(productSchema).default([]),
  loadCases: z.array(loadCaseSchema).default([]),
  layers: z.array(layerSchema).default([]),
  penetration: penetrationRuleSchema.nullable().default(null),
  buildUp: buildUpSchema,
  optimisation: optimisationSchema,
  /**
   * Per-value provenance, keyed by dotted value path (e.g. `layers.furring.maxSpacing`).
   * Every entered figure should carry one; the validator reports those that do not.
   */
  citations: z.record(z.string(), citationSchema).default({}),
});
export type RulePack = z.infer<typeof rulePackSchema>;
