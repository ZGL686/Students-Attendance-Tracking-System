import type { Workbook, Worksheet } from 'exceljs';
import { parseCsv } from '../../files';
import { checkAborted } from './model';
import type { CourseDraft, ImportDocumentDiagnostic, ImportSource, ReadOptions } from './model';
import type { GridCell } from './parse';
import { readCourseTable } from './table-diagnostics';

async function loadWorkbook(file: File, signal?: AbortSignal): Promise<Workbook> {
  checkAborted(signal);
  const { default: ExcelJS } = await import('exceljs');
  const bytes = await file.arrayBuffer();
  checkAborted(signal);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes);
  } catch {
    checkAborted(signal);
    throw new Error('无法读取 Excel 文件，请确认文件未损坏，并在 Excel 中另存为 .xlsx 后重试。');
  }
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
): Promise<{
  drafts: CourseDraft[];
  sources: ImportSource[];
  documents: ImportDocumentDiagnostic[];
}> {
  const { signal, onProgress, selection } = options;
  onProgress?.({ stage: '正在读取 Excel 表格…', progress: 0.1 });
  checkAborted(signal);
  if (file.name.toLowerCase().endsWith('.csv')) {
    const rows = parseCsv(await file.text());
    checkAborted(signal);
    if (rows.length > 5000 || rows.some((row) => row.length > 150))
      throw new Error('课表范围过大，请只保留课表区域。');
    const cells = rows.flatMap((row, r) => row.map((text, c) => ({ row: r, column: c, text })));
    const table =
      selection && !selection.includes(0) ? undefined : readCourseTable(cells, file.name);
    return {
      drafts: table?.drafts ?? [],
      sources: [{ index: 0, label: 'CSV 表格' }],
      documents: table ? [table.document] : [],
    };
  }
  const workbook = await loadWorkbook(file, signal);
  const sources = workbook.worksheets.map((sheet, index) => ({ index, label: sheet.name }));
  const drafts: CourseDraft[] = [];
  const documents: ImportDocumentDiagnostic[] = [];
  workbook.worksheets.forEach((sheet, index) => {
    checkAborted(signal);
    if (selection && !selection.includes(index)) return;
    const table = readCourseTable(worksheetCells(sheet), `${file.name} · ${sheet.name}`);
    drafts.push(...table.drafts);
    documents.push(table.document);
    onProgress?.({
      stage: `已读取工作表“${sheet.name}”`,
      progress: (index + 1) / workbook.worksheets.length,
    });
  });
  return { drafts, sources, documents };
}
