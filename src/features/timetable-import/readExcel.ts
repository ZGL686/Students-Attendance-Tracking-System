import type { Workbook, Worksheet } from 'exceljs';
import { parseCsv } from '../../files';
import { checkAborted } from './model';
import type { CourseDraft, ImportSource, ReadOptions } from './model';
import { parseGrid } from './parse';
import type { GridCell } from './parse';

async function loadWorkbook(file: File, signal?: AbortSignal): Promise<Workbook> {
  checkAborted(signal);
  const { default: ExcelJS } = await import('exceljs');
  const bytes = await file.arrayBuffer();
  checkAborted(signal);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  checkAborted(signal);
  return workbook;
}

function coordinate(address: string): { row: number; column: number } {
  const match = address.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) throw new Error('工作表包含无法读取的合并区域。');
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

export function worksheetCells(sheet: Worksheet): GridCell[] {
  if (sheet.rowCount > 5000 || sheet.columnCount > 150)
    throw new Error('课表范围过大，请只保留课表区域（最多 5000 行、150 列）。');
  const spans = new Map<string, { rowSpan: number; columnSpan: number }>();
  for (const range of sheet.model.merges ?? []) {
    const [first, last = first] = range.split(':');
    const a = coordinate(first),
      b = coordinate(last);
    spans.set(first.replace(/\$/g, ''), {
      rowSpan: b.row - a.row + 1,
      columnSpan: b.column - a.column + 1,
    });
  }
  const cells: GridCell[] = [];
  sheet.eachRow((row, rowNumber) =>
    row.eachCell((cell, columnNumber) => {
      // Slave cells return the master's text; reading them again duplicates courses.
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const text = cell.text.trim();
      if (text)
        cells.push({
          row: rowNumber - 1,
          column: columnNumber - 1,
          text,
          ...spans.get(cell.address),
        });
    }),
  );
  return cells;
}

export async function inspectExcel(file: File, signal?: AbortSignal): Promise<ImportSource[]> {
  if (file.name.toLowerCase().endsWith('.csv')) return [{ index: 0, label: 'CSV 表格' }];
  const workbook = await loadWorkbook(file, signal);
  return workbook.worksheets.map((sheet, index) => ({ index, label: sheet.name }));
}

export async function readExcel(
  file: File,
  options: ReadOptions,
): Promise<{ drafts: CourseDraft[]; sources: ImportSource[] }> {
  const { signal, onProgress, selection } = options;
  onProgress?.({ stage: '正在读取 Excel 表格…', progress: 0.1 });
  checkAborted(signal);
  if (file.name.toLowerCase().endsWith('.csv')) {
    const rows = parseCsv(await file.text());
    checkAborted(signal);
    if (rows.length > 5000 || rows.some((row) => row.length > 150))
      throw new Error('课表范围过大，请只保留课表区域。');
    const cells = rows.flatMap((row, r) => row.map((text, c) => ({ row: r, column: c, text })));
    return {
      drafts: selection && !selection.includes(0) ? [] : parseGrid(cells, file.name),
      sources: [{ index: 0, label: 'CSV 表格' }],
    };
  }
  const workbook = await loadWorkbook(file, signal);
  const sources = workbook.worksheets.map((sheet, index) => ({ index, label: sheet.name }));
  const drafts: CourseDraft[] = [];
  workbook.worksheets.forEach((sheet, index) => {
    checkAborted(signal);
    if (selection && !selection.includes(index)) return;
    drafts.push(...parseGrid(worksheetCells(sheet), `${file.name} · ${sheet.name}`));
    onProgress?.({
      stage: `已读取工作表“${sheet.name}”`,
      progress: (index + 1) / workbook.worksheets.length,
    });
  });
  return { drafts, sources };
}
