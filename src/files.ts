import type { AppData, Student, Workspace } from './model';
import { counts, dataSchema, uid } from './model';
import { isTauriApp } from './platform';

export async function chooseTextFile(extensions: string[]): Promise<string | null> {
  if (!isTauriApp) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Ludian备份文件', extensions }],
  });
  if (!selected || Array.isArray(selected)) return null;
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return readTextFile(selected);
}

export async function download(
  name: string,
  content: string | Uint8Array,
  mime = 'application/octet-stream',
): Promise<boolean> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  if (isTauriApp) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: name,
      filters: [{ name: 'Ludian导出文件', extensions: [name.split('.').pop()!] }],
    });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return true;
}
async function digest(data: unknown) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(data))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function createBackup(data: AppData) {
  const payload = dataSchema.parse(data);
  return JSON.stringify(
    {
      format: 'guilu-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      checksum: await digest(payload),
      data: payload,
    },
    null,
    2,
  );
}
export async function parseBackup(value: string): Promise<AppData> {
  const b = JSON.parse(value.replace(/^\uFEFF/, ''));
  if (b.format !== 'guilu-backup' || b.version !== 1)
    throw new Error('不是受支持的Ludian备份文件（版本 1）。');
  if ((await digest(b.data)) !== b.checksum)
    throw new Error('备份校验不通过，文件可能被修改或损坏。');
  return dataSchema.parse(b.data);
}
export async function readRoster(file: File): Promise<Student[]> {
  if (file.size > 10 * 1024 * 1024) throw new Error('名单文件不能超过 10 MB。');
  let rows: string[][] = [];
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('工作簿中没有工作表。');
    sheet.eachRow((row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        values[col - 1] = cell.text.trim();
      });
      rows.push(values);
    });
  } else if (file.name.toLowerCase().endsWith('.csv')) rows = parseCsv(await file.text());
  else throw new Error('请选择 .xlsx 或 UTF-8 编码的 .csv 文件。');
  const headerIndex = rows.findIndex(
    (r) =>
      r.some((v) => ['姓名', '学生姓名', 'name'].includes(v?.trim().toLowerCase())) &&
      r.some((v) => ['学号', '学生学号', 'number', 'studentid'].includes(v?.trim().toLowerCase())),
  );
  if (headerIndex < 0) throw new Error('未找到“姓名”和“学号”表头，请检查第一张工作表。');
  const header = rows[headerIndex].map((v) => (v || '').trim().toLowerCase());
  const index = (names: string[]) => header.findIndex((v) => names.includes(v));
  const ni = index(['姓名', '学生姓名', 'name']),
    si = index(['学号', '学生学号', 'number', 'studentid']),
    gi = index(['班级', '专业', 'group']);
  const students: Student[] = [];
  const seen = new Set<string>();
  rows.slice(headerIndex + 1).forEach((r, i) => {
    if (!r.some((v) => v?.trim())) return;
    const name = (r[ni] || '').trim(),
      number = (r[si] || '').trim();
    if (!name || !number) throw new Error(`第 ${headerIndex + i + 2} 行缺少姓名或学号。`);
    if (seen.has(number)) throw new Error(`名单中存在重复学号：${number}。`);
    seen.add(number);
    students.push({ id: uid(), name, number, group: r[gi] || '' });
  });
  if (!students.length) throw new Error('未读取到学生。');
  return students;
}
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 引号未闭合。');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export type ReportFilter = { from: string; to: string; course: string };
export function reportRows(w: Workspace, f: ReportFilter) {
  return w.students.map((s) => {
    const c = counts(w, s.id, f.from, f.to, f.course);
    return [
      s.number,
      s.name,
      s.group,
      ...w.categories.map((k) => c[k.id]),
      Object.values(c).reduce((a, b) => a + b, 0),
    ];
  });
}
const safe = (value: unknown) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
export function markdownReport(w: Workspace, f: ReportFilter) {
  const headers = ['学号', '姓名', '班级', ...w.categories.map((c) => c.label), '合计'];
  const details = w.records.filter(
    (r) =>
      !r.voided && r.date >= f.from && r.date <= f.to && (!f.course || r.courseName === f.course),
  );
  return `# ${safe(w.name)} · 考勤汇总\n\n学期：${safe(w.term)}  \n日期：${f.from} 至 ${f.to}  \n课程：${safe(f.course || '全部课程')}  \n统计口径：异常考勤记录次数，未登记不代表已确认出勤。\n\n| ${headers.map(safe).join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${reportRows(
    w,
    f,
  )
    .map((row) => '| ' + row.map(safe).join(' | ') + ' |')
    .join(
      '\n',
    )}\n\n## 考勤明细\n\n| 日期 | 时间（北京） | 学号 | 姓名 | 类型 | 课程 | 教室 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${details
    .map((r) => {
      const s = w.students.find((s) => s.id === r.studentId)!;
      return (
        '| ' +
        [
          r.date,
          r.time,
          s.number,
          s.name,
          w.categories.find((c) => c.id === r.category)!.label,
          r.courseName,
          r.room,
          r.note,
        ]
          .map(safe)
          .join(' | ') +
        ' |'
      );
    })
    .join('\n')}\n`;
}
export async function excelReport(w: Workspace, f: ReportFilter) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'Ludian';
  book.created = new Date();
  const summary = book.addWorksheet('考勤汇总');
  summary.addRow([`${w.name} · ${w.term}`]);
  summary.addRow([`${f.from} 至 ${f.to} · ${f.course || '全部课程'}`]);
  summary.addRow(['统计异常考勤次数，未登记不代表已确认出勤。']);
  summary.addRow(['学号', '姓名', '班级', ...w.categories.map((c) => c.label), '合计']);
  summary.addRows(reportRows(w, f));
  summary.columns.forEach((c, i) => {
    c.width = i === 0 ? 20 : i === 2 ? 24 : 12;
  });
  summary.views = [{ state: 'frozen', ySplit: 4, xSplit: 2 }];
  summary.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: 4 + w.categories.length },
  };
  const detail = book.addWorksheet('考勤明细');
  detail.addRow([
    '日期',
    '时间（北京）',
    '学号',
    '姓名',
    '类型',
    '课程',
    '教师',
    '教室',
    '备注',
    '记录 ID',
  ]);
  for (const r of w.records
    .filter(
      (r) =>
        !r.voided && r.date >= f.from && r.date <= f.to && (!f.course || r.courseName === f.course),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    const s = w.students.find((s) => s.id === r.studentId)!;
    const row = detail.addRow([
      new Date(r.date + 'T00:00:00Z'),
      r.time,
      s.number,
      s.name,
      w.categories.find((c) => c.id === r.category)!.label,
      r.courseName,
      r.teacher,
      r.room,
      r.note,
      r.id,
    ]);
    row.getCell(1).numFmt = 'yyyy-mm-dd';
  }
  detail.columns.forEach((c, i) => {
    c.width = [15, 16, 20, 12, 12, 28, 14, 30, 40, 38][i];
  });
  detail.views = [{ state: 'frozen', ySplit: 1 }];
  detail.autoFilter = 'A1:J1';
  for (const [sheet, header] of [
    [summary, 4],
    [detail, 1],
  ] as const) {
    sheet.getRow(header).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF353A34' } };
      cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    });
    sheet.eachRow((row, i) => {
      row.height = i === header ? 28 : 24;
      row.eachCell((cell) => {
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (i !== header) cell.font = { name: 'Microsoft YaHei', size: 11 };
      });
    });
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}
