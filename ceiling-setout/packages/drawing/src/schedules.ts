import type { GenerationResult, Issue, Member, Nesting } from '@ceiling/engine';
import { quantise } from '@ceiling/geometry';
import type { RulePack } from '@ceiling/rules';

export interface Table {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
  /** Shown above the table on every sheet it appears on. */
  readonly note: string;
}

/**
 * Member schedule: what to cut, by type, product and length.
 *
 * Grouped by product and length rather than listed one member per line, because that
 * is how a cutting list is used - forty identical 2400mm furring channels are one
 * line on the saw, not forty.
 */
export function memberSchedule(result: GenerationResult): Table {
  const groups = new Map<string, { type: string; product: string; length: number; zone: string; count: number }>();
  for (const m of result.members) {
    // Hangers are scheduled with their coordinates and drops; clips, brackets and the
    // like are counted, not cut. Listing either here as a 0mm cut length would put a
    // meaningless line on the saw list.
    if (m.type === 'hanger' || m.planLength === 0) continue;
    const product = m.productCode ?? '(no product selected)';
    const length = Math.round(m.length);
    const key = `${m.zoneId}|${m.type}|${product}|${length}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { type: m.type, product, length, zone: m.zoneId, count: 1 });
  }

  const rows = [...groups.values()]
    .sort(
      (a, b) =>
        a.zone.localeCompare(b.zone) ||
        a.type.localeCompare(b.type) ||
        a.product.localeCompare(b.product) ||
        b.length - a.length,
    )
    .map((g) => [g.zone, g.type, g.product, g.length, g.count, quantise((g.length * g.count) / 1000)]);

  return {
    name: 'Member schedule',
    columns: ['Zone', 'Type', 'Product', 'Cut length (mm)', 'Qty', 'Total (m)'],
    rows,
    note: 'Cut lengths are true lengths on the ceiling plane, so members on a rake are longer than they measure in plan.',
  };
}

/**
 * Component schedule: the connectors that are counted rather than cut - clips,
 * brackets, and anything else that exists at a point.
 */
export function componentSchedule(result: GenerationResult): Table {
  const groups = new Map<string, { zone: string; type: string; product: string; layer: string; count: number }>();
  for (const m of result.members) {
    if (m.type === 'hanger' || m.planLength > 0) continue;
    const product = m.productCode ?? '(no product selected)';
    const key = `${m.zoneId}|${m.type}|${product}|${m.layerId}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { zone: m.zoneId, type: m.type, product, layer: m.layerId, count: 1 });
  }
  const rows = [...groups.values()]
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.type.localeCompare(b.type) || a.product.localeCompare(b.product))
    .map((g) => [g.zone, g.type, g.layer, g.product, g.count]);
  return {
    name: 'Component schedule',
    columns: ['Zone', 'Type', 'Layer', 'Product', 'Qty'],
    rows,
    note: 'Connectors counted at each connection. Add the supplier\'s allowance for waste and site losses.',
  };
}

/**
 * Hanger schedule: where every hanger is, how long it is, and what it fixes to.
 *
 * Coordinates are the setout coordinates, not measurements off a drawing, so the
 * schedule and the model cannot disagree.
 */
export function hangerSchedule(result: GenerationResult): Table {
  const rows = result.members
    .filter((m) => m.type === 'hanger')
    .sort((a, b) => a.zoneId.localeCompare(b.zoneId) || a.start.x - b.start.x || a.start.y - b.start.y)
    .map((m) => {
      const fixing = m.fixings[0];
      return [
        m.zoneId,
        m.id,
        Math.round(m.start.x),
        Math.round(m.start.y),
        Math.round(m.length),
        Math.round(m.end.z),
        Math.round(m.start.z),
        fixing?.type ?? '',
        fixing?.substrate ?? '',
        fixing?.count ?? 1,
      ];
    });

  return {
    name: 'Hanger schedule',
    columns: [
      'Zone',
      'Ref',
      'X (mm)',
      'Y (mm)',
      'Drop (mm)',
      'Fix level',
      'Bottom level',
      'Fixing',
      'Substrate',
      'No.',
    ],
    rows,
    note: 'Drops are measured from the fixing level down to the top of the system, and vary across a rake or a stepped soffit.',
  };
}

/** Bill of materials from the cut nesting: stock bars, waste and pack quantities. */
export function billOfMaterials(nesting: Record<string, Nesting>, packs: readonly RulePack[]): Table {
  const rows: (string | number)[][] = [];
  for (const [packKey, nest] of Object.entries(nesting).sort()) {
    for (const p of nest.products) {
      rows.push([
        packKey,
        p.productCode,
        p.description,
        p.barCount,
        p.bars[0]?.stockLength ?? '',
        quantise(p.totalCut / 1000),
        quantise(p.totalStock / 1000),
        quantise(p.waste / 1000),
        p.wastePercent,
        p.packQuantity ?? '',
        p.packsRequired ?? '',
        p.oversize.length,
      ]);
    }
  }
  const uncosted = packs.filter((p) => p.optimisation.stockLengths === null && p.catalogue.every((c) => c.stockLengths === null));
  return {
    name: 'Bill of materials',
    columns: [
      'Rule pack',
      'Product',
      'Description',
      'Bars',
      'Stock length (mm)',
      'Cut (m)',
      'Stock (m)',
      'Waste (m)',
      'Waste %',
      'Pack qty',
      'Packs',
      'Over stock length',
    ],
    rows,
    note:
      uncosted.length > 0
        ? 'Stock lengths have not been entered for every product, so those lines carry no bar count or waste figure.'
        : 'Bars are nested first-fit-decreasing onto the shortest stock length that fits each piece. Pieces longer than the longest stock length are counted separately and need joining.',
  };
}

/** Every flagged item with its location, worst first. */
export function issuesReport(result: GenerationResult): Table {
  const rows = result.issues.map((i: Issue) => [
    i.severity,
    i.code,
    i.zoneId ?? '',
    i.message,
    i.location ? `${Math.round(i.location.x)}, ${Math.round(i.location.y)}` : '',
    i.ruleId ?? '',
    i.memberIds.join(' '),
  ]);
  return {
    name: 'Issues',
    columns: ['Severity', 'Code', 'Zone', 'Issue', 'Location', 'Rule', 'Members'],
    rows,
    note: 'Everything the validator flagged, against the values entered in the rule pack. Structural verification remains with the engineer.',
  };
}

/** Where every member came from: the rule, the pack version and the reason. */
export function provenanceReport(result: GenerationResult): Table {
  const seen = new Map<string, { rule: string; pack: string; reason: string; spacing: number | null; count: number; citation: string }>();
  for (const m of result.members) {
    const key = `${m.layerId}|${m.provenance.ruleId}|${m.provenance.reason}`;
    const existing = seen.get(key);
    if (existing) existing.count++;
    else
      seen.set(key, {
        rule: m.provenance.ruleId,
        pack: m.provenance.rulePackVersion,
        reason: m.provenance.reason,
        spacing: m.provenance.spacingUsed,
        count: 1,
        citation: m.provenance.citation ?? '',
      });
  }
  const rows = [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => [key.split('|')[0]!, v.rule, v.spacing ?? '', v.count, v.reason, v.pack, v.citation]);
  return {
    name: 'Provenance',
    columns: ['Layer', 'Rule', 'Spacing used', 'Members', 'Reason', 'Rule pack', 'Source'],
    rows,
    note: 'Every member records the value that put it where it is, and where that value was said to come from.',
  };
}

/** The tables that make up a full issue: schedules, BOM, issues and provenance. */
export function allTables(
  result: GenerationResult & { nesting: Record<string, Nesting> },
  packs: readonly RulePack[],
): Table[] {
  return [
    memberSchedule(result),
    componentSchedule(result),
    hangerSchedule(result),
    billOfMaterials(result.nesting, packs),
    issuesReport(result),
    provenanceReport(result),
  ];
}

export type { Member };
