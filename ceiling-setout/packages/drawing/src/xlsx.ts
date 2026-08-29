import ExcelJS from 'exceljs';
import type { Table } from './schedules.js';

/**
 * Schedules as a workbook, one sheet per table.
 *
 * Numbers are written as numbers, not as text, because the first thing anyone does
 * with a member schedule is total a column.
 */
export async function toWorkbook(tables: readonly Table[], banner: string): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = 'Ceiling setout';

  for (const table of tables) {
    const sheet = book.addWorksheet(table.name.slice(0, 31));

    const bannerRow = sheet.addRow([banner]);
    bannerRow.font = { bold: true, size: 9 };
    sheet.mergeCells(1, 1, 1, Math.max(1, table.columns.length));
    bannerRow.alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(1).height = 28;

    const noteRow = sheet.addRow([table.note]);
    noteRow.font = { italic: true, size: 9 };
    sheet.mergeCells(2, 1, 2, Math.max(1, table.columns.length));
    noteRow.alignment = { wrapText: true, vertical: 'top' };

    sheet.addRow([]);

    const header = sheet.addRow([...table.columns]);
    header.font = { bold: true };
    header.border = { bottom: { style: 'thin' } };

    for (const row of table.rows) sheet.addRow([...row]);

    table.columns.forEach((c, i) => {
      const longest = Math.max(c.length, ...table.rows.map((r) => String(r[i] ?? '').length));
      sheet.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
    });

    sheet.views = [{ state: 'frozen', ySplit: header.number }];
    if (table.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: header.number, column: 1 },
        to: { row: header.number + table.rows.length, column: table.columns.length },
      };
    }
  }

  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
