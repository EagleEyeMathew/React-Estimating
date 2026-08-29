import type { Table } from './schedules.js';

/**
 * RFC 4180 CSV. Fields containing a comma, quote or newline are quoted and internal
 * quotes doubled - a member description with a comma in it must not silently split a
 * schedule into the wrong columns.
 */
export function toCsv(table: Table, includeNote = true): string {
  const lines: string[] = [];
  if (includeNote) {
    lines.push(escape(table.name));
    lines.push(escape(table.note));
    lines.push('');
  }
  lines.push(table.columns.map(escape).join(','));
  for (const row of table.rows) lines.push(row.map(escape).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function escape(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
