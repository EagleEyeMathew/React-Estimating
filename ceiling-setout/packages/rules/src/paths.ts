import type { Citation, RulePack } from './schema.js';

/** One editable figure in a pack, as the rule pack editor sees it. */
export interface ValueSlot {
  /** Dotted path, also the key used in `citations` and in member provenance. */
  readonly path: string;
  readonly label: string;
  /** Grouping for the editor UI. */
  readonly group: string;
  readonly units: 'mm' | 'mm2' | 'kg/m' | 'kg/m2' | 'deg' | 'count';
  readonly value: number | null;
  readonly citation: Citation | null;
  /**
   * Whether generation fails without it. A figure on a disabled layer is never
   * required - the layer generates nothing - but it stays editable so the user can
   * fill it in before switching the layer on.
   */
  readonly required: boolean;
  /** False for figures belonging to a layer that is switched off. */
  readonly active: boolean;
}

const slot = (
  pack: RulePack,
  path: string,
  label: string,
  group: string,
  units: ValueSlot['units'],
  value: number | null,
  required: boolean,
  active = true,
): ValueSlot => ({
  path,
  label,
  group,
  units,
  value,
  citation: pack.citations[path] ?? null,
  required: required && active,
  active,
});

/**
 * Every numeric figure in a pack, in a stable order.
 *
 * This is what the rule pack editor renders and what the readiness report counts. It
 * is derived from the pack rather than hand-listed, so a figure added to the schema
 * cannot be silently un-editable.
 */
export function valueSlots(pack: RulePack): ValueSlot[] {
  const out: ValueSlot[] = [];

  for (const p of pack.catalogue) {
    const g = `Catalogue / ${p.code}`;
    out.push(slot(pack, `catalogue.${p.code}.massPerMetre`, 'Mass per metre', g, 'kg/m', p.massPerMetre, false));
    out.push(slot(pack, `catalogue.${p.code}.depth`, 'Section depth', g, 'mm', p.depth, false));
    out.push(slot(pack, `catalogue.${p.code}.width`, 'Section width', g, 'mm', p.width, false));
  }

  for (const c of pack.loadCases) {
    const g = `Load case / ${c.id}`;
    out.push(slot(pack, `loadCases.${c.id}.massPerSquareMetre`, 'Design load', g, 'kg/m2', c.massPerSquareMetre, false));
    for (const l of c.limits) {
      out.push(slot(pack, `loadCases.${c.id}.limits.${l.layerId}.maxSpacing`, `${l.layerId} max spacing`, g, 'mm', l.maxSpacing, false));
      out.push(slot(pack, `loadCases.${c.id}.limits.${l.layerId}.maxSpan`, `${l.layerId} max span`, g, 'mm', l.maxSpan, false));
    }
  }

  for (const l of pack.layers) {
    const g = `Layer / ${l.id}${l.enabled ? '' : ' (off)'}`;
    const base = `layers.${l.id}`;
    const on = l.enabled;
    out.push(slot(pack, `${base}.heightAboveFcl`, 'Height above FCL', g, 'mm', l.heightAboveFcl, false, on));
    switch (l.generator) {
      case 'line-array':
        out.push(slot(pack, `${base}.maxSpacing`, 'Max spacing', g, 'mm', l.maxSpacing, l.module === null, on));
        out.push(slot(pack, `${base}.module`, 'Fixed module', g, 'mm', l.module, false, on));
        out.push(slot(pack, `${base}.maxFromWall`, 'Max from wall', g, 'mm', l.maxFromWall, true, on));
        out.push(slot(pack, `${base}.minSegmentLength`, 'Min usable length', g, 'mm', l.minSegmentLength, false, on));
        out.push(slot(pack, `${base}.maxEndOverhang`, 'Max end overhang', g, 'mm', l.maxEndOverhang, false, on));
        break;
      case 'along-member':
        out.push(slot(pack, `${base}.maxSpacing`, 'Max spacing along member', g, 'mm', l.maxSpacing, true, on));
        out.push(slot(pack, `${base}.firstFromEnd`, 'First from free end', g, 'mm', l.firstFromEnd, true, on));
        break;
      case 'perimeter':
        out.push(slot(pack, `${base}.fixingCentres`, 'Fixing centres', g, 'mm', l.fixingCentres, true, on));
        out.push(slot(pack, `${base}.firstFixingFromCorner`, 'First fixing from corner', g, 'mm', l.firstFixingFromCorner, true, on));
        break;
      case 'brace':
        out.push(slot(pack, `${base}.gridSpacing`, 'Brace grid spacing', g, 'mm', l.gridSpacing, true, on));
        out.push(slot(pack, `${base}.maxFromWall`, 'Max from wall', g, 'mm', l.maxFromWall, true, on));
        out.push(slot(pack, `${base}.angleFromVertical`, 'Angle from vertical', g, 'deg', l.angleFromVertical, false, on));
        out.push(slot(pack, `${base}.minDropToRequire`, 'Drop above which bracing applies', g, 'mm', l.minDropToRequire, false, on));
        break;
    }
  }

  if (pack.penetration) {
    const g = 'Penetrations';
    const p = pack.penetration;
    out.push(slot(pack, 'penetration.trimAboveArea', 'Trim above area', g, 'mm2', p.trimAboveArea, false));
    out.push(slot(pack, 'penetration.trimAboveWidth', 'Trim above width', g, 'mm', p.trimAboveWidth, false));
    out.push(slot(pack, 'penetration.clearance', 'Clearance around opening', g, 'mm', p.clearance, true));
    out.push(slot(pack, 'penetration.doubleAboveWidth', 'Double trimmer above width', g, 'mm', p.doubleAboveWidth, false));
    out.push(slot(pack, 'penetration.minClearOfMember', 'Min clear of member centreline', g, 'mm', p.minClearOfMember, false));
  }

  const bu = 'Build-up';
  out.push(slot(pack, 'buildUp.liningThickness', 'Lining thickness', bu, 'mm', pack.buildUp.liningThickness, false));
  out.push(slot(pack, 'buildUp.systemDepth', 'System depth', bu, 'mm', pack.buildUp.systemDepth, true));
  out.push(slot(pack, 'buildUp.minHangerDrop', 'Min hanger drop', bu, 'mm', pack.buildUp.minHangerDrop, false));
  out.push(slot(pack, 'buildUp.maxHangerDrop', 'Max hanger drop', bu, 'mm', pack.buildUp.maxHangerDrop, false));

  const op = 'Optimisation';
  out.push(slot(pack, 'optimisation.kerf', 'Saw kerf', op, 'mm', pack.optimisation.kerf, false));
  out.push(slot(pack, 'optimisation.minReusableOffcut', 'Min reusable offcut', op, 'mm', pack.optimisation.minReusableOffcut, false));

  return out;
}

export interface PackReadiness {
  readonly total: number;
  readonly entered: number;
  readonly requiredTotal: number;
  readonly requiredEntered: number;
  /** Entered figures with no citation - the pack is usable but not defensible. */
  readonly uncited: readonly string[];
  readonly missingRequired: readonly string[];
  /** True when every required figure is entered. Says nothing about whether they are right. */
  readonly generatable: boolean;
}

/** How far a pack is from being usable, for the editor's progress display. */
export function readiness(pack: RulePack): PackReadiness {
  const slots = valueSlots(pack);
  const entered = slots.filter((s) => s.value !== null);
  const required = slots.filter((s) => s.required);
  const missingRequired = required.filter((s) => s.value === null).map((s) => s.path);
  return {
    total: slots.length,
    entered: entered.length,
    requiredTotal: required.length,
    requiredEntered: required.length - missingRequired.length,
    uncited: entered.filter((s) => s.citation === null).map((s) => s.path),
    missingRequired,
    generatable: missingRequired.length === 0,
  };
}

/** Read a figure by its dotted path. Used by the editor and by provenance display. */
export function valueAt(pack: RulePack, path: string): number | null {
  return valueSlots(pack).find((s) => s.path === path)?.value ?? null;
}
