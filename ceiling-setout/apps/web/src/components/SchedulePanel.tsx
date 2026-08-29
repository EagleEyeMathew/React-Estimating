import { useMemo, useState } from 'react';
import { allTables, toCsv, type Table } from '@ceiling/drawing';
import { useStore } from '../state/store.js';

/** The schedules, as they will be issued, readable before anything is exported. */
export function SchedulePanel() {
  const result = useStore((s) => s.result);
  const packs = useStore((s) => s.packs);
  const [active, setActive] = useState(0);

  const tables: Table[] = useMemo(() => (result ? allTables(result, packs) : []), [result, packs]);
  if (tables.length === 0) return <div className="panel-empty">Nothing generated.</div>;
  const table = tables[Math.min(active, tables.length - 1)]!;

  return (
    <div className="panel schedules">
      <div className="segmented wrap">
        {tables.map((t, i) => (
          <button key={t.name} className={i === active ? 'active' : ''} onClick={() => setActive(i)}>
            {t.name} <span className="count">{t.rows.length}</span>
          </button>
        ))}
      </div>
      <p className="note">{table.note}</p>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className={typeof cell === 'number' ? 'num' : ''}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length === 0 && <p className="note">Nothing to report.</p>}
      </div>
      <button onClick={() => download(`${table.name.toLowerCase().replace(/\W+/g, '-')}.csv`, toCsv(table), 'text/csv')}>
        Download this table as CSV
      </button>
    </div>
  );
}

export function download(name: string, content: string | Uint8Array, type: string): void {
  const blob = new Blob([content as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
