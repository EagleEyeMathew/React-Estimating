import { describe, expect, it } from 'vitest';
import { generate, ringToBoundaryZone } from './helpers.js';
import { dimensionZone, fitArc, sectionThrough } from '../src/dimensions.js';
import { billOfMaterials, componentSchedule, hangerSchedule, issuesReport, memberSchedule, provenanceReport } from '../src/schedules.js';
import { toCsv } from '../src/csv.js';
import { zoneToDxf } from '../src/dxf.js';
import { fitViewport, scaleText, toSheet } from '../src/sheet.js';
import { buildDocumentSet } from '../src/issue.js';

const { project, result, packs } = generate();
const zoneResult = result.zones[0]!;
const zone = project.zones[0]!;

describe('dimensions', () => {
  const dims = dimensionZone(zone, zoneResult);

  it('dimensions the first member off each wall', () => {
    const first = dims.filter((d) => d.kind === 'first-from-wall');
    expect(first.length).toBeGreaterThanOrEqual(2);
    for (const d of first) {
      expect(d.value).toBeGreaterThan(0);
      expect(d.note).toMatch(/wall/);
    }
  });

  it('runs a chain of running dimensions through the members', () => {
    const running = dims.filter((d) => d.kind === 'running' && d.note.includes('furring'));
    expect(running.length).toBeGreaterThan(3);
    // Every bay in the chain is at the spacing the engine actually used.
    for (const d of running) expect(d.value).toBeLessThanOrEqual(450 + 1);
  });

  it('gives the overall size on both axes', () => {
    const overall = dims.filter((d) => d.kind === 'overall');
    expect(overall).toHaveLength(2);
    expect(overall.map((d) => d.value).sort((a, b) => a - b)).toEqual([4000, 6000]);
  });

  it('dimensions every penetration centre off the setout datum', () => {
    const withLight = generate({ withPenetrations: true });
    const d = dimensionZone(withLight.project.zones[0]!, withLight.result.zones[0]!);
    const pen = d.filter((x) => x.kind === 'penetration');
    expect(pen.length).toBe(withLight.project.zones[0]!.penetrations.length * 2);
    for (const p of pen) expect(p.note).toMatch(/datum/);
  });

  it('dimensions a curved run back to its true arc, not to the chords', () => {
    const curved = generate({ withColumn: true });
    const d = dimensionZone(curved.project.zones[0]!, curved.result.zones[0]!);
    const radial = d.filter((x) => x.kind === 'radial');
    expect(radial.length).toBeGreaterThan(0);
    // The column is 400mm radius; the chords sit just inside it.
    expect(radial[0]!.value).toBeGreaterThan(390);
    expect(radial[0]!.value).toBeLessThanOrEqual(400);
    expect(radial[0]!.note).toMatch(/true radius/);
    expect(radial[0]!.text).toMatch(/^R\d+$/);
  });

  it('fits a circle to points that lie on one, and refuses points that do not', () => {
    const circlePoints = Array.from({ length: 12 }, (_, i) => ({
      x: 1000 + 500 * Math.cos((i * Math.PI) / 6),
      y: 2000 + 500 * Math.sin((i * Math.PI) / 6),
    }));
    const fitted = fitArc(circlePoints)!;
    expect(fitted.radius).toBeCloseTo(500, 3);
    expect(fitted.centre.x).toBeCloseTo(1000, 3);
    expect(fitArc([{ x: 0, y: 0 }, { x: 100, y: 5 }, { x: 200, y: 0 }, { x: 300, y: 900 }])).toBeNull();
  });
});

describe('sections', () => {
  it('reports the drop at every hanger on the cut', () => {
    const section = sectionThrough(zoneResult, { x: 0, y: 2000 }, { x: 6000, y: 2000 }, 600);
    expect(section.entries.length).toBeGreaterThan(0);
    for (const e of section.entries) {
      expect(e.drop).toBe(e.structureLevel - e.ceilingLevel);
      expect(e.drop).toBeGreaterThan(0);
    }
    // Ordered along the cut, so the section reads left to right.
    const distances = section.entries.map((e) => e.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('shows the drops varying on a rake', () => {
    const raked = generate({ raked: true });
    const section = sectionThrough(raked.result.zones[0]!, { x: 0, y: 2000 }, { x: 6000, y: 2000 }, 600);
    const drops = section.entries.map((e) => e.drop);
    expect(new Set(drops).size).toBeGreaterThan(1);
    // Rising ceiling means shortening drops.
    expect(drops[0]!).toBeGreaterThan(drops[drops.length - 1]!);
  });
});

describe('schedules', () => {
  it('groups the member schedule by product and cut length', () => {
    const table = memberSchedule(result);
    expect(table.columns).toContain('Cut length (mm)');
    expect(table.rows.length).toBeGreaterThan(0);
    const keys = table.rows.map((r) => `${r[0]}|${r[1]}|${r[2]}|${r[3]}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Every row totals correctly.
    for (const r of table.rows) {
      expect(Number(r[5])).toBeCloseTo((Number(r[3]) * Number(r[4])) / 1000, 3);
    }
  });

  it('counts point components instead of listing them as zero-length cuts', () => {
    const cuts = memberSchedule(result);
    for (const r of cuts.rows) expect(Number(r[3])).toBeGreaterThan(0);
    const components = componentSchedule(result);
    expect(components.rows.length).toBeGreaterThan(0);
    const clips = components.rows.find((r) => r[2] === 'clip')!;
    expect(Number(clips[4])).toBe(result.members.filter((m) => m.layerId === 'clip').length);
  });

  it('runs perimeter trim round walls and voids, but not round a service opening', () => {
    const both = generate({ withPenetrations: true, withColumn: true });
    const trim = both.result.members.filter((m) => m.type === 'trim');
    // Four walls plus one curved run around the column - and nothing round the diffuser.
    expect(trim).toHaveLength(5);
    expect(trim.filter((m) => m.path !== undefined)).toHaveLength(1);
    const diffuser = both.project.zones[0]!.penetrations.find((p) => p.kind === 'diffuser')!;
    for (const t of trim) {
      const d = Math.hypot(t.start.x - diffuser.shape.centre.x, t.start.y - diffuser.shape.centre.y);
      expect(d).toBeGreaterThan(400);
    }
  });

  it('gives every hanger a coordinate, a drop and a substrate', () => {
    const table = hangerSchedule(result);
    expect(table.rows.length).toBe(result.members.filter((m) => m.type === 'hanger').length);
    for (const r of table.rows) {
      expect(Number(r[4])).toBeGreaterThan(0);
      expect(r[8]).toBe('concrete soffit');
    }
  });

  it('reports stock, waste and packs in the bill of materials', () => {
    const table = billOfMaterials(result.nesting, packs);
    expect(table.rows.length).toBeGreaterThan(0);
    for (const r of table.rows) {
      const stock = Number(r[6]);
      const cut = Number(r[5]);
      if (stock > 0) expect(stock).toBeGreaterThanOrEqual(cut - 1e-6);
    }
  });

  it('lists every issue with its location and rule', () => {
    const table = issuesReport(result);
    expect(table.columns).toEqual(['Severity', 'Code', 'Zone', 'Issue', 'Location', 'Rule', 'Members']);
    expect(table.note).toMatch(/engineer/);
  });

  it('reports where every member came from', () => {
    const table = provenanceReport(result);
    expect(table.rows.length).toBeGreaterThan(0);
    for (const r of table.rows) expect(String(r[5])).toMatch(/@/); // pack version on every row

    // A member placed by a figure carries that figure's source. A member placed by a
    // rule with no figure behind it - trim following the boundary - has none, and the
    // blank is the point: it shows the reader which decisions rest on entered values.
    const fromFigure = table.rows.filter((r) => /\.(maxSpacing|maxSpan|firstFromEnd|module)$/.test(String(r[1])));
    expect(fromFigure.length).toBeGreaterThan(0);
    for (const r of fromFigure) expect(String(r[6])).toMatch(/EXAMPLE DATA/);
  });
});

describe('csv', () => {
  it('quotes fields containing commas and quotes', () => {
    const csv = toCsv({
      name: 'T',
      note: 'n',
      columns: ['a', 'b'],
      rows: [['plain', 'has, comma'], ['has "quotes"', 'line\nbreak']],
    });
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quotes"""');
    expect(csv).toContain('"line\nbreak"');
  });

  it('carries the table note above the data', () => {
    const csv = toCsv(memberSchedule(result));
    expect(csv.split('\r\n')[1]).toMatch(/true lengths/);
  });
});

describe('dxf', () => {
  const dxf = zoneToDxf(zone, zoneResult, dimensionZone(zone, zoneResult));

  it('is a well-formed R12 file', () => {
    expect(dxf.startsWith('0\r\nSECTION')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('AC1009');
    // Sections balance.
    const opens = (dxf.match(/\r\nSECTION\r\n/g) ?? []).length;
    const closes = (dxf.match(/\r\nENDSEC\r\n/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('declares its units as millimetres', () => {
    expect(dxf).toContain('$INSUNITS');
  });

  it('puts each member type on its own layer', () => {
    expect(dxf).toContain('CEIL-FURRING');
    expect(dxf).toContain('CEIL-TSR');
    expect(dxf).toContain('CEIL-HANGER');
    expect(dxf).toContain('CEIL-BOUNDARY');
    expect(dxf).toContain('CEIL-DIMS');
  });

  it('draws the setout datum so the plan can be set out on site', () => {
    expect(dxf).toContain('SETOUT DATUM');
  });

  it('writes one entity per member', () => {
    const lines = (dxf.match(/\r\n0\r\nLINE\r\n/g) ?? []).length;
    expect(lines).toBeGreaterThan(result.members.filter((m) => m.planLength > 0).length);
  });

  it('draws hangers as circles', () => {
    const circles = (dxf.match(/\r\n0\r\nCIRCLE\r\n/g) ?? []).length;
    expect(circles).toBeGreaterThanOrEqual(result.members.filter((m) => m.type === 'hanger').length);
  });
});

describe('sheet layout', () => {
  it('rounds out to a scale a drafter would use', () => {
    const vp = fitViewport({ x: 0, y: 0 }, { x: 12000, y: 8000 }, 'A3');
    expect([20, 25, 50, 100]).toContain(vp.scale);
    expect(scaleText(vp.scale)).toMatch(/^1:\d+$/);
  });

  it('keeps the whole model inside the frame', () => {
    const vp = fitViewport({ x: -1000, y: -1000 }, { x: 12000, y: 8000 }, 'A3');
    for (const p of [{ x: -1000, y: -1000 }, { x: 12000, y: 8000 }]) {
      const s = toSheet(p, vp);
      expect(s.x).toBeGreaterThanOrEqual(vp.frame.x - 0.001);
      expect(s.x).toBeLessThanOrEqual(vp.frame.x + vp.frame.width + 0.001);
      expect(s.y).toBeGreaterThanOrEqual(vp.frame.y - 0.001);
      expect(s.y).toBeLessThanOrEqual(vp.frame.y + vp.frame.height + 0.001);
    }
  });

  it('centres the plan in the frame', () => {
    const vp = fitViewport({ x: 0, y: 0 }, { x: 1000, y: 1000 }, 'A3');
    const a = toSheet({ x: 0, y: 0 }, vp);
    const b = toSheet({ x: 1000, y: 1000 }, vp);
    expect(a.x - vp.frame.x).toBeCloseTo(vp.frame.x + vp.frame.width - b.x, 6);
  });
});

describe('document set', () => {
  it('builds drawings, schedules and exports from one generation run', async () => {
    const set = await buildDocumentSet(project, result, packs, {
      drawingNumber: 'CS-001',
      revision: 'A',
      date: '2026-08-29',
      drawnBy: 'EED',
    });

    expect(set.pdf.length).toBeGreaterThan(2000);
    expect(new TextDecoder().decode(set.pdf.slice(0, 5))).toBe('%PDF-');
    expect(set.xlsx.length).toBeGreaterThan(2000);
    // XLSX is a zip.
    expect([...set.xlsx.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(set.dxf).toContain('CEIL-FURRING');
    expect(Object.keys(set.csv).sort()).toEqual([
      'bill-of-materials.csv',
      'component-schedule.csv',
      'hanger-schedule.csv',
      'issues.csv',
      'member-schedule.csv',
      'provenance.csv',
    ]);
    expect(set.sections.length).toBe(2);
  });

  it('puts the standing of the numbers on every output', async () => {
    const set = await buildDocumentSet(project, result, packs, {
      drawingNumber: 'CS-001',
      revision: 'A',
      date: '2026-08-29',
      drawnBy: 'EED',
    });
    expect(set.banner).toMatch(/INVENTED EXAMPLE DATA/);
    expect(set.banner).toMatch(/engineer/);
    for (const csv of Object.values(set.csv)) expect(csv.length).toBeGreaterThan(10);
  });
});
