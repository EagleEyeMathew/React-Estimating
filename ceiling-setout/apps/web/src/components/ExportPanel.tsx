import { useState } from 'react';
import { buildDocumentSet } from '@ceiling/drawing';
import { useStore } from '../state/store.js';
import { download } from './SchedulePanel.js';

/**
 * The issue. Drawings, schedules and exports are built from one generation result, so
 * a drawing and its schedule cannot come from different runs.
 */
export function ExportPanel() {
  const project = useStore((s) => s.project);
  const result = useStore((s) => s.result);
  const packs = useStore((s) => s.packs);
  const [drawingNumber, setDrawingNumber] = useState('CS-001');
  const [revision, setRevision] = useState('A');
  const [drawnBy, setDrawnBy] = useState('EED');
  const [size, setSize] = useState<'A3' | 'A2' | 'A1'>('A3');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const issue = async (): Promise<void> => {
    if (!result) return;
    setBusy(true);
    setDone(null);
    try {
      const set = await buildDocumentSet(project, result, packs, {
        drawingNumber,
        revision,
        drawnBy,
        date: new Date().toISOString().slice(0, 10),
        size,
      });
      download(`${drawingNumber}-${revision}.pdf`, set.pdf, 'application/pdf');
      download(`${drawingNumber}-${revision}.dxf`, set.dxf, 'image/vnd.dxf');
      download(`${drawingNumber}-${revision}-schedules.xlsx`, set.xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      for (const [name, csv] of Object.entries(set.csv)) download(name, csv, 'text/csv');
      setDone(`Issued ${Object.keys(set.csv).length + 3} files.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <section>
        <h3>Issue drawings</h3>
        <label>
          <span>Drawing number</span>
          <input value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} />
        </label>
        <label>
          <span>Revision</span>
          <input value={revision} onChange={(e) => setRevision(e.target.value)} />
        </label>
        <label>
          <span>Drawn by</span>
          <input value={drawnBy} onChange={(e) => setDrawnBy(e.target.value)} />
        </label>
        <label>
          <span>Sheet size</span>
          <select value={size} onChange={(e) => setSize(e.target.value as 'A3' | 'A2' | 'A1')}>
            <option value="A3">A3</option>
            <option value="A2">A2</option>
            <option value="A1">A1</option>
          </select>
        </label>
        <button className="primary" onClick={issue} disabled={busy || !result}>
          {busy ? 'Building...' : 'Build the issue'}
        </button>
        {done && <p className="note">{done}</p>}
        <p className="note">
          A reflected ceiling plan per zone, sections through the void, the schedules and the bill of materials, plus
          a DXF of the setout. Every sheet carries the standing of the figures behind it.
        </p>
      </section>

      <section>
        <h3>Project</h3>
        <button
          onClick={() =>
            download(`${project.id}.json`, JSON.stringify({ project, packs }, null, 2), 'application/json')
          }
        >
          Save project as JSON
        </button>
        <p className="note">
          The project is one JSON document and carries the rule pack version each zone was generated against, so
          reopening it regenerates the drawing that was issued rather than whatever the current pack would produce.
        </p>
      </section>
    </div>
  );
}
