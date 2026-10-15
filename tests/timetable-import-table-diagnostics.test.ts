import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readExcel } from '../src/features/timetable-import/readExcel';
import { readCourseTable } from '../src/features/timetable-import/table-diagnostics';
import { validateDrafts } from '../src/features/timetable-import/model';
import { readImportFiles } from '../src/features/timetable-import/read';

const cells = (rows: string[][]) =>
  rows.flatMap((row, r) => row.map((text, column) => ({ row: r, column, text })));

async function workbookFile(sheets: { name: string; rows: string[][] }[]) {
  const workbook = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRows(rows);
  }
  return new File([new Uint8Array(await workbook.xlsx.writeBuffer())], '虚构课程表.xlsx');
}

describe('course spreadsheet file diagnostics', () => {
  it.each([
    [
      ['学号', '姓名', '班级'],
      ['TEST001', '虚构同学甲', '测试一班'],
    ],
    [
      ['name', 'number', 'group'],
      ['Fictional Student', 'TEST001', 'Test Class'],
    ],
    [
      ['姓名', '性别'],
      ['虚构同学乙', '测试'],
    ],
  ])('rejects student lists before names can become courses', async (header, row) => {
    const file = new File([[header, row].map((values) => values.join(',')).join('\n')], '名单.csv');
    const result = await readExcel(file, {});
    expect(result.drafts).toEqual([]);
    expect(result.documents).toEqual([
      expect.objectContaining({
        kind: 'student-list',
        message: expect.stringContaining('学生名单'),
      }),
    ]);
    expect(result.documents[0].message).toContain('“学生”页导入');
    expect(result.documents[0].message).not.toContain(row[0]);
  });

  it('retains complete course fields even when a sheet also includes student fields', () => {
    const result = readCourseTable(
      cells([
        ['学号', '姓名', '课程名称', '星期', '节次', '周次'],
        ['TEST001', '虚构同学甲', '数字设计', '周一', '1-2', '1-16'],
      ]),
      '混合表',
    );
    expect(result.document.kind).toBe('courses');
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].name).toBe('数字设计');
    expect(validateDrafts(result.drafts, [], 'append').courses).toHaveLength(1);
  });

  it('distinguishes an empty file, a header-only course table and unrelated content', async () => {
    const empty = await readExcel(new File(['\n,\n'], '空表.csv'), {});
    expect(empty.documents[0]).toMatchObject({
      kind: 'empty',
      message: expect.stringContaining('为空'),
    });
    const header = await readExcel(new File(['课程名称,星期,节次,周次'], '空课表.csv'), {});
    expect(header.documents[0]).toMatchObject({
      kind: 'empty',
      message: expect.stringContaining('只有表头'),
    });
    const unrelated = await readExcel(new File(['物品,数量\n测试物品,2'], '物品.csv'), {});
    expect(unrelated.drafts).toEqual([]);
    expect(unrelated.documents[0]).toMatchObject({
      kind: 'unrelated',
      message: expect.stringContaining('没有找到课程信息'),
    });
  });

  it('identifies a course catalog without mistaking it for a student list', () => {
    const result = readCourseTable(
      cells([
        ['课程名称', '课程代码', '教师', '学分'],
        ['数字设计', 'TEST001', '测试教师', '2'],
      ]),
      '课程目录',
    );
    expect(result.drafts).toEqual([]);
    expect(result.document).toMatchObject({
      kind: 'course-catalog',
      missingFields: ['星期', '开始、结束节次'],
      message: expect.stringContaining('只有课程目录'),
    });
  });

  it('explains missing schedule fields and retains incomplete rows for skipped reasons', () => {
    for (const rows of [
      [
        ['课程名称', '星期', '周次'],
        ['数字设计', '周二', '1-16'],
      ],
      [
        ['课程名称', '开始节次', '结束节次', '周次'],
        ['数字设计', '1', '2', '1-16'],
      ],
      [
        ['课程名称', '星期', '节次'],
        ['数字设计', '周二', '1-2'],
      ],
    ]) {
      const result = readCourseTable(cells(rows), '缺失字段');
      expect(result.drafts).toHaveLength(1);
      expect(result.document.kind).toBe('missing-fields');
      expect(result.document.missingFields?.length).toBeGreaterThan(0);
      expect(validateDrafts(result.drafts, [], 'append').courses).toEqual([]);
    }
    const missingWeeks = readCourseTable(
      cells([
        ['课程名称', '星期', '节次'],
        ['数字设计', '周二', '1-2'],
      ]),
      '缺周次',
    );
    expect(missingWeeks.document.missingFields).toEqual(['上课周次']);
  });

  it('explains invalid values and keeps valid rows from the same sheet', () => {
    const result = readCourseTable(
      cells([
        ['课程名称', '星期', '节次', '周次'],
        ['数字设计', '周一', '1-2', '1-16'],
        ['测试算法', '未知', '1、3', '1-16'],
      ]),
      '部分有效',
    );
    expect(result.document).toMatchObject({
      kind: 'courses',
      message: expect.stringContaining('1 条缺少有效字段'),
    });
    expect(result.drafts).toHaveLength(2);
    const ready = validateDrafts(result.drafts, [], 'append');
    expect(ready.courses).toHaveLength(1);
    expect(ready.issues).toHaveLength(1);
  });

  it('reads every selected worksheet while preserving per-sheet wrong-file diagnostics', async () => {
    const file = await workbookFile([
      {
        name: '学生名单',
        rows: [
          ['学号', '姓名'],
          ['TEST001', '虚构同学甲'],
        ],
      },
      { name: '空白', rows: [] },
      {
        name: '课程',
        rows: [
          ['课程名称', '星期', '节次', '周次'],
          ['数字设计', '周二', '3-4', '1-16'],
        ],
      },
      {
        name: '课程目录',
        rows: [
          ['课程名称', '教师'],
          ['测试算法', '测试教师'],
        ],
      },
    ]);
    const result = await readExcel(file, {});
    expect(result.drafts.map((draft) => draft.name)).toEqual(['数字设计']);
    expect(result.documents.map((document) => document.kind)).toEqual([
      'student-list',
      'empty',
      'courses',
      'course-catalog',
    ]);
    expect(result.documents.map((document) => document.source)).toEqual(
      ['学生名单', '空白', '课程', '课程目录'].map((sheet) => `${file.name} · ${sheet}`),
    );
    const selected = await readExcel(file, { selection: [2] });
    expect(selected.drafts).toHaveLength(1);
    expect(selected.documents).toHaveLength(1);
    expect(selected.documents[0].kind).toBe('courses');
  });

  it('merges valid CSV files while exposing every wrong-file reason in the batch', async () => {
    const result = await readImportFiles([
      new File(['学号,姓名\nTEST001,虚构同学甲'], '误选名单.csv'),
      new File(['课程名称,星期,节次,周次\n数字设计,周二,3-4,1-16'], '课程.csv'),
      new File(['物品,数量\n测试物品,2'], '误选物品.csv'),
    ]);
    expect(result.drafts.map((draft) => draft.name)).toEqual(['数字设计']);
    expect(result.documents?.map((document) => document.kind)).toEqual([
      'student-list',
      'courses',
      'unrelated',
    ]);
    const allWrong = await readImportFiles([
      new File(['学号,姓名\nTEST001,虚构同学甲'], '误选名单.csv'),
      new File(['课程名称,教师\n数字设计,测试教师'], '只有目录.csv'),
    ]);
    expect(allWrong.drafts).toEqual([]);
    expect(allWrong.documents?.map((document) => document.kind)).toEqual([
      'student-list',
      'course-catalog',
    ]);
  });

  it('keeps merged long timetable spans and missing weeks for latest-semester assignment', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('课程');
    sheet.addRow(['节次', '周一', '周二']);
    for (let period = 1; period <= 8; period++) sheet.addRow([String(period)]);
    sheet.mergeCells('B6:B9');
    sheet.getCell('B6').value = '数字设计';
    const file = new File([new Uint8Array(await workbook.xlsx.writeBuffer())], '合并网格.xlsx');
    const result = await readExcel(file, {});
    expect(result.documents[0].kind).toBe('courses');
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]).toMatchObject({
      name: '数字设计',
      day: '1',
      start: '5',
      end: '8',
      weeks: '',
      layout: 'grid',
    });
  });

  it('reports damaged workbook content without leaking low-level library errors', async () => {
    await expect(readExcel(new File(['not an xlsx'], '损坏.xlsx'), {})).rejects.toThrow(
      '无法读取 Excel 文件',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      readExcel(new File(['not an xlsx'], '取消.xlsx'), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
