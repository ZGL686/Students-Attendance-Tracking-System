import { parseImportDay } from './model';
import type { CourseDraft, ImportDocumentDiagnostic } from './model';
import { dayInHeader, parseGrid, parsePeriodLabel } from './parse';
import type { GridCell } from './parse';
import { hasSchedulingFields, normalizeTableLabel, tableHeaders } from './table-fields';
import type { TableHeader } from './table-fields';

const studentNames = ['姓名', '学生姓名', '学生名字', '学生', 'name', 'studentname', 'student'];
const studentDetails = [
  '学号',
  '学生学号',
  '学生编号',
  '班级',
  '性别',
  'studentid',
  'studentnumber',
  'number',
  'class',
  'gender',
];

function scheduleColumns(columns: TableHeader['columns']): boolean {
  return (
    'name' in columns &&
    'day' in columns &&
    ('periods' in columns || ('start' in columns && 'end' in columns))
  );
}

function isStudentList(cells: GridCell[], headers: TableHeader[]): boolean {
  // A workbook can include course fields beside student fields. Prefer the explicit
  // complete schedule in that case; never interpret a roster's names as courses.
  if (headers.some(({ columns }) => scheduleColumns(columns))) return false;
  return headers.some(({ row }) => {
    const labels = cells
      .filter((cell) => cell.row === row)
      .map((cell) => normalizeTableLabel(cell.text));
    return (
      labels.some((label) => studentNames.includes(label)) &&
      labels.some((label) => studentDetails.includes(label))
    );
  });
}

function missingDraftFields(draft: CourseDraft): string[] {
  const missing: string[] = [];
  if (!draft.name.trim()) missing.push('课程名称');
  if (!parseImportDay(draft.day)) missing.push('星期');
  if (
    !/^\d{1,2}$/.test(draft.start) ||
    !/^\d{1,2}$/.test(draft.end) ||
    Number(draft.start) < 1 ||
    Number(draft.end) > 10 ||
    Number(draft.end) < Number(draft.start)
  )
    missing.push('开始、结束节次');
  if (draft.layout === 'list' && !draft.weeks.trim()) missing.push('上课周次');
  return missing;
}

/** Classify each worksheet separately so an unrelated sheet cannot discard valid courses. */
export function readCourseTable(
  cells: GridCell[],
  source: string,
): { drafts: CourseDraft[]; document: ImportDocumentDiagnostic } {
  const content = cells.filter((cell) => cell.text.trim());
  const diagnostic = (
    kind: ImportDocumentDiagnostic['kind'],
    message: string,
    missingFields?: string[],
  ): ImportDocumentDiagnostic => ({
    source,
    kind,
    message,
    ...(missingFields ? { missingFields } : {}),
  });
  if (!content.length)
    return { drafts: [], document: diagnostic('empty', '表格为空，没有可导入的课程信息。') };
  const headers = tableHeaders(content);
  if (isStudentList(content, headers))
    return {
      drafts: [],
      document: diagnostic('student-list', '这是学生名单，请到“学生”页导入；课程表没有修改。'),
    };
  const nameHeader = headers
    .filter(({ columns }) => 'name' in columns)
    .sort((a, b) => Object.keys(b.columns).length - Object.keys(a.columns).length)[0];
  if (nameHeader && !content.some((cell) => cell.row > nameHeader.row))
    return { drafts: [], document: diagnostic('empty', '只有表头，没有课程记录。') };
  if (nameHeader && !hasSchedulingFields(nameHeader.columns))
    return {
      drafts: [],
      document: diagnostic(
        'course-catalog',
        '只有课程目录，缺少星期和节次，不能生成课表。请选择包含排课信息的课程表。',
        ['星期', '开始、结束节次'],
      ),
    };
  const drafts = parseGrid(content, source);
  if (drafts.length) {
    const incomplete = drafts.map(missingDraftFields);
    const missing = [...new Set(incomplete.flat())];
    const complete = incomplete.filter((fields) => !fields.length).length;
    return {
      drafts,
      document: complete
        ? diagnostic(
            'courses',
            `已读取 ${drafts.length} 条课程安排${complete < drafts.length ? `，其中 ${drafts.length - complete} 条缺少有效字段，将跳过并列出原因` : ''}。`,
          )
        : diagnostic(
            'missing-fields',
            `课程信息缺少有效的${missing.join('、')}，没有可直接导入的完整安排。`,
            missing,
          ),
    };
  }
  if (nameHeader) {
    const missing: string[] = [];
    if (!('day' in nameHeader.columns)) missing.push('星期');
    if (
      !('periods' in nameHeader.columns) &&
      !('start' in nameHeader.columns && 'end' in nameHeader.columns)
    )
      missing.push('开始、结束节次');
    if (!('weeks' in nameHeader.columns)) missing.push('上课周次');
    return {
      drafts: [],
      document: diagnostic(
        'missing-fields',
        missing.length
          ? `课程表缺少${missing.join('、')}字段，未导入。`
          : '没有读取到课程记录，请检查课程名称和排课字段。',
        missing,
      ),
    };
  }
  const dayLabels = content.filter((cell) => dayInHeader(cell.text));
  if (dayLabels.length >= 2) {
    const missing = content.some(
      (cell) =>
        cell.column < Math.min(...dayLabels.map((item) => item.column)) &&
        parsePeriodLabel(cell.text),
    )
      ? ['课程格内容']
      : ['左侧节次行'];
    return {
      drafts: [],
      document: diagnostic(
        'missing-fields',
        `课表缺少有效的${missing.join('、')}，未找到可导入的安排。`,
        missing,
      ),
    };
  }
  return {
    drafts: [],
    document: diagnostic(
      'unrelated',
      '文件中没有找到课程信息。请选择含课程名称、星期、节次和周次的 Excel / CSV 课表。',
    ),
  };
}
