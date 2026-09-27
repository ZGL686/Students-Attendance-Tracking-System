import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { Course } from '../src/model';
import {
  abortable,
  courseFingerprint,
  coursesOverlap,
  createEmptyDraft,
  parseImportWeeks,
  validateDrafts,
} from '../src/features/timetable-import/model';
import {
  draftFromText,
  parseGrid,
  parsePositionedText,
} from '../src/features/timetable-import/parse';
import { inspectImportFile, readImportFile } from '../src/features/timetable-import/read';
import { worksheetCells } from '../src/features/timetable-import/readExcel';

const draft = () => ({
  ...createEmptyDraft('虚构课表'),
  name: '数字设计',
  day: '1',
  start: '1',
  end: '2',
  weeks: '1-16',
});
const course = (): Course => ({
  id: 'old-course',
  name: '数字设计',
  day: 1,
  start: 1,
  end: 2,
  weeks: Array.from({ length: 16 }, (_, i) => i + 1),
  teacher: '',
  room: '',
  color: 'blue',
});

describe('course import validation', () => {
  it('parses discontinuous weeks and per-range odd/even qualifiers without inventing weeks', () => {
    expect(parseImportWeeks('第 1—8 周（单周）')).toEqual([1, 3, 5, 7]);
    expect(parseImportWeeks('1-4,8-12(双)')).toEqual([2, 4, 8, 10, 12]);
    expect(parseImportWeeks('1-4(单),6-10(双)')).toEqual([1, 3, 6, 8, 10]);
    expect(parseImportWeeks('１～３周，５周')).toEqual([1, 2, 3, 5]);
    for (const input of ['', '单周', '0-2', '3-1', '31', '1,', '2(单)'])
      expect(() => parseImportWeeks(input)).toThrow();
  });

  it('requires missing fields, rejects semester overflow, and permits correction of an OCR warning', () => {
    const value = { ...draft(), weeks: '', issues: ['未识别周次'] };
    expect(validateDrafts([value], [], 'append', 20).issues[0].message).toContain('填写上课周次');
    value.weeks = '1-16';
    expect(validateDrafts([value], [], 'append', 20).issues).toEqual([]);
    value.weeks = '1-21';
    expect(validateDrafts([value], [], 'append', 20).issues[0].message).toContain('20 周');
    expect(validateDrafts([{ ...draft(), end: '11' }], [], 'append').issues).toHaveLength(1);
    expect(
      validateDrafts([{ ...draft(), start: '3', end: '2' }], [], 'append').issues,
    ).toHaveLength(1);
  });

  it('skips exact duplicates but reports conflicts including conflicts inside a batch', () => {
    const existing = [course()];
    const before = structuredClone(existing);
    const same = { ...draft(), color: 'purple' as const };
    const overlap = { ...draft(), name: '另一门课', start: '2', end: '3' };
    const result = validateDrafts([same, overlap], existing, 'append');
    expect(result.duplicates).toBe(1);
    expect(result.issues[0].message).toContain('重叠');
    expect(existing).toEqual(before);
    expect(validateDrafts([draft(), overlap], [], 'replace').issues).toHaveLength(1);
    expect(validateDrafts([overlap], existing, 'replace').courses).toHaveLength(1);
  });

  it('allows adjacent periods and disjoint weeks, preserving stable duplicate semantics', () => {
    const first = course();
    expect(coursesOverlap(first, { ...first, start: 3, end: 4 })).toBe(false);
    expect(coursesOverlap(first, { ...first, weeks: [17] })).toBe(false);
    expect(courseFingerprint(first)).toBe(
      courseFingerprint({
        ...first,
        id: 'other',
        color: 'pink',
        weeks: [...first.weeks].reverse(),
      }),
    );
    const result = validateDrafts([{ ...draft(), weeks: '17-20' }], [first], 'append', 20);
    expect(result.courses).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('rejects cancellation promptly and releases the abort listener', async () => {
    const controller = new AbortController();
    let canceled = false;
    const pending = abortable(new Promise<never>(() => {}), controller.signal, () => {
      canceled = true;
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(canceled).toBe(true);
  });
});

describe('spreadsheet and OCR parsing with fictional classes', () => {
  it('reads a column-based course list and leaves absent weeks for correction', () => {
    const rows = [
      ['课程名称', '星期', '节次', '周次', '教师', '教室'],
      ['数字设计', '星期二', '3-4节', '1-16周(单)', '测试教师', '测试教室'],
      ['算法入门', '周五', '5-6', '', '', ''],
    ];
    const result = parseGrid(
      rows.flatMap((row, r) => row.map((text, c) => ({ row: r, column: c, text }))),
      '课表',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: '数字设计',
      day: '2',
      start: '3',
      end: '4',
      teacher: '测试教师',
    });
    expect(result[1].weeks).toBe('');
    expect(validateDrafts(result, [], 'append').issues).toHaveLength(1);
  });

  it('reads merged timetable cells once and derives the full period span', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('测试网格');
    sheet.addRow(['节次', '星期一', '星期二', '星期三']);
    for (let i = 1; i <= 4; i++) sheet.addRow([`第${i}节`]);
    sheet.mergeCells('B2:B3');
    sheet.getCell('B2').value = '数字设计\n教师：测试老师\n教室：测试101\n1-16周（单）';
    sheet.mergeCells('C4:C5');
    sheet.getCell('C4').value = '算法入门\n2-16周（双）';
    const result = parseGrid(worksheetCells(sheet), '测试网格');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: '数字设计',
      start: '1',
      end: '2',
      day: '1',
      teacher: '测试老师',
      room: '测试101',
    });
    expect(result[1]).toMatchObject({ name: '算法入门', start: '3', end: '4', day: '2' });
    expect(validateDrafts(result, [], 'append', 20).issues).toEqual([]);
  });

  it('does not assign a weekday to a merged course spanning two weekday columns', () => {
    const cells = [
      { row: 0, column: 1, text: '周一' },
      { row: 0, column: 2, text: '周二' },
      { row: 1, column: 0, text: '1-2节' },
      { row: 1, column: 1, columnSpan: 2, text: '数字设计\n1-16周' },
    ];
    const result = parseGrid(cells, '测试课表');
    expect(result[0].day).toBe('');
    expect(result[0].issues.join()).toContain('跨越');
  });

  it('uses weekday coordinates for OCR text and explicitly marks inferred periods', () => {
    const token = (text: string, x: number, y: number, width = 60) => ({
      text,
      x,
      y,
      width,
      height: 10,
      confidence: 96,
    });
    const result = parsePositionedText(
      [
        token('星期一', 130, 0),
        token('星期二', 230, 0),
        token('1', 10, 30, 10),
        token('2', 10, 60, 10),
        token('数字设计', 115, 30),
        token('1-16周', 115, 48),
        token('算法入门', 215, 30),
        token('1-16周(双)', 215, 48, 85),
      ],
      '截图',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: '数字设计', day: '1', start: '1', end: '2' });
    expect(result[0].issues.join()).toContain('相邻表格行');
    expect(result[1].day).toBe('2');
  });

  it('preserves raw OCR text and never fabricates a week range', () => {
    const result = draftFromText('数字设计\n星期三\n第3-4节', '图片');
    expect(result).toMatchObject({ name: '数字设计', day: '3', start: '3', end: '4', weeks: '' });
    expect(result.rawText).toContain('星期三');
    expect(result.issues.join()).toContain('周次');
    expect(draftFromText('数字设计\n周次：1-16(单)', '图片').weeks).toBe('1-16(单)');
    expect(draftFromText('数字设计\n1-16(单周)', '图片').weeks).toBe('1-16(单周)');
  });

  it('reads a complete period list and leaves disjoint or multiple periods for correction', () => {
    for (const expression of ['第1、2节', '第1,2节', '第1-2节']) {
      expect(draftFromText(`数字设计\n星期一\n${expression}\n1-16周`, '图片')).toMatchObject({
        start: '1',
        end: '2',
      });
    }
    for (const expression of ['第1、3节', '第1,3节', '第1节和第3节']) {
      const draft = draftFromText(`数字设计\n星期一\n${expression}\n1-16周`, '图片');
      expect(draft).toMatchObject({ start: '', end: '' });
      expect(validateDrafts([draft], [], 'append').issues).toHaveLength(1);
    }
  });

  it('does not assign distant OCR content to the last visible period', () => {
    const token = (text: string, x: number, y: number, width = 60) => ({
      text,
      x,
      y,
      width,
      height: 10,
    });
    const result = parsePositionedText(
      [
        token('星期一', 130, 0),
        token('星期二', 230, 0),
        token('1', 10, 30, 10),
        token('2', 10, 60, 10),
        token('数字设计', 115, 500),
        token('1-16周', 115, 518),
      ],
      '截图',
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: '', end: '', day: '1' });
    expect(validateDrafts(result, [], 'append').issues).toHaveLength(1);
  });

  it('keeps a thin weekday glyph on the same OCR line as its heading', () => {
    const result = parsePositionedText(
      [
        { text: '星期', x: 120, y: 10, width: 40, height: 30 },
        { text: '一', x: 165, y: 29, width: 20, height: 2 },
        { text: '星期二', x: 260, y: 10, width: 60, height: 30 },
        { text: '数字设计', x: 120, y: 75, width: 65, height: 20 },
        { text: '1-16周', x: 120, y: 105, width: 65, height: 20 },
        { text: '第1-2节', x: 120, y: 135, width: 65, height: 20 },
      ],
      '截图',
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: '数字设计', day: '1', start: '1', end: '2' });
  });

  it('does not invent a missing period when an Excel merge crosses disjoint period rows', () => {
    const result = parseGrid(
      [
        { row: 0, column: 1, text: '周一' },
        { row: 0, column: 2, text: '周二' },
        { row: 1, column: 0, text: '第1节' },
        { row: 2, column: 0, text: '第3节' },
        { row: 1, column: 1, rowSpan: 2, text: '数字设计\n1-16周' },
      ],
      '合并网格',
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ start: '', end: '' });
    expect(result[0].issues.join()).toContain('不连续');
    expect(validateDrafts(result, [], 'append').issues).toHaveLength(1);
  });

  it('selects requested worksheets and keeps file reading entirely local', async () => {
    const workbook = new ExcelJS.Workbook();
    for (const label of ['测试一班', '测试二班']) {
      const sheet = workbook.addWorksheet(label);
      sheet.addRow(['课程名称', '星期', '节次', '周次']);
      sheet.addRow([label + '课程', '周一', '1-2', '1-16']);
    }
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const file = new File([bytes], '测试课表.xlsx');
    expect(await inspectImportFile(file)).toEqual([
      { index: 0, label: '测试一班' },
      { index: 1, label: '测试二班' },
    ]);
    const result = await readImportFile(file, { selection: [1] });
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].name).toBe('测试二班课程');
  });

  it('reports unsupported files and returns an editable blank draft for an empty result', async () => {
    await expect(readImportFile(new File(['data'], '课表.xls'))).rejects.toThrow('.xlsx');
    const result = await readImportFile(new File(['无课表内容'], '课表.csv'));
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].name).toBe('');
    expect(result.warnings.join()).toContain('空白草稿');
  });
});
