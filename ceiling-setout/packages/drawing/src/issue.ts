import type { GenerationResult, Nesting, Project, Zone } from '@ceiling/engine';
import type { RulePack } from '@ceiling/rules';
import { dimensionZone, sectionThrough, type Dimension, type Section } from './dimensions.js';
import { allTables, type Table } from './schedules.js';
import { toCsv } from './csv.js';
import { projectToDxf } from './dxf.js';
import { buildPdf, type PdfOptions } from './pdf.js';
import { toWorkbook } from './xlsx.js';
import type { SheetSize, TitleBlock } from './sheet.js';

export interface IssueDetails {
  readonly drawingNumber: string;
  readonly revision: string;
  readonly date: string;
  readonly drawnBy: string;
  readonly drawingTitle?: string;
  readonly size?: SheetSize;
}

export interface DocumentSet {
  readonly dimensions: readonly Dimension[];
  readonly sections: readonly Section[];
  readonly tables: readonly Table[];
  readonly dxf: string;
  readonly csv: Readonly<Record<string, string>>;
  readonly pdf: Uint8Array;
  readonly xlsx: Uint8Array;
  readonly banner: string;
}

/**
 * Everything that goes out with an issue, built from one generation result.
 *
 * They are produced together on purpose. A drawing whose schedule was generated from
 * a different run is the classic way a job goes wrong, and building them from one
 * result makes that impossible rather than merely unlikely.
 */
export async function buildDocumentSet(
  project: Project,
  result: GenerationResult & { nesting: Record<string, Nesting> },
  packs: readonly RulePack[],
  details: IssueDetails,
): Promise<DocumentSet> {
  const dimensions: Dimension[] = [];
  const sections: Section[] = [];

  for (const zoneResult of result.zones) {
    const zone = project.zones.find((z) => z.id === zoneResult.zoneId);
    if (!zone) continue;
    dimensions.push(...dimensionZone(zone, zoneResult));
    sections.push(...defaultSections(zoneResult));
  }

  const tables = allTables(result, packs);
  const banner = result.banners.join(' ');

  const titleBlock: Omit<TitleBlock, 'scaleText'> = {
    project: project.name,
    client: project.client,
    drawingTitle: details.drawingTitle ?? 'Reflected ceiling plan - setout',
    drawingNumber: details.drawingNumber,
    revision: details.revision,
    date: details.date,
    drawnBy: details.drawnBy,
    levelDatum: project.levelDatum,
    provenanceNote: banner,
  };

  const pdfOptions: PdfOptions = {
    size: details.size ?? 'A3',
    titleBlock,
    dimensions,
    sections,
    tables,
  };

  const csv: Record<string, string> = {};
  for (const table of tables) csv[fileName(table.name)] = toCsv(table);

  return {
    dimensions,
    sections,
    tables,
    dxf: projectToDxf(result, project.zones, dimensions),
    csv,
    pdf: await buildPdf(result, project.zones, pdfOptions),
    xlsx: await toWorkbook(tables, banner),
    banner,
  };
}

/**
 * A section across the zone and one along it, through the middle.
 *
 * Two cuts through the middle are what a drafter draws first, and on a rake they are
 * the two that actually differ.
 */
function defaultSections(zoneResult: GenerationResult['zones'][number]): Section[] {
  const points = zoneResult.region.flatMap((p) => [...p.outer]);
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const midY = (minY + maxY) / 2;
  const midX = (minX + maxX) / 2;
  return [
    sectionThrough(zoneResult, { x: minX, y: midY }, { x: maxX, y: midY }, 600, `${zoneResult.zoneId}-AA`),
    sectionThrough(zoneResult, { x: midX, y: minY }, { x: midX, y: maxY }, 600, `${zoneResult.zoneId}-BB`),
  ];
}

const fileName = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;

export type { Zone };
