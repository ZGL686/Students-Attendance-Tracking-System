import { createEmptyDraft, parseImportDay, parseImportWeeks } from './model';
import type { CourseDraft } from './model';
import { formatWeeks } from '../../model';

export type GridCell = {
  row: number;
  column: number;
  rowSpan?: number;
  columnSpan?: number;
  text: string;
};
export type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
};

const normalize = (text: string) =>
  text.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
const weekPattern =
  /(?:第)?\d{1,2}(?:\s*[-~～—–至]\s*\d{1,2})?(?:\s*[,，、]\s*\d{1,2}(?:\s*[-~～—–至]\s*\d{1,2})?)*\s*(?:周(?:\s*[（(]?[单双]周?[)）]?)?|[（(][单双]周?[)）]周?)/g;
const periodPattern =
  /(?<![\d,，、\-~～—–至])(?:第\s*)?\d{1,2}(?:\s*[-~～—–至,，、]\s*\d{1,2})*\s*节/;
const colors = ['blue', 'purple', 'teal', 'pink', 'amber', 'green'] as const;

type PeriodSpan = { start: number; end: number };

function continuousSpan(spans: PeriodSpan[]): PeriodSpan | undefined {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  if (!sorted.length) return undefined;
  const result = { ...sorted[0] };
  for (const span of sorted.slice(1)) {
    if (span.start > result.end + 1) return undefined;
    result.end = Math.max(result.end, span.end);
  }
  return result;
}

export function parsePeriodLabel(text: string): { start: number; end: number } | undefined {
  const chinese: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const clean = normalize(text)
    .trim()
    .split('\n')[0]
    .replace(/\s+/g, '')
    .replace(/[～~—–至]/g, '-');
  const expression = clean.replace(/^第/, '').replace(/节(?:课)?$/, '');
  const spans: PeriodSpan[] = [];
  for (const segment of expression.split(/[,，、]/)) {
    const match = segment.match(
      /^([\d一二三四五六七八九十]{1,2})(?:-([\d一二三四五六七八九十]{1,2}))?$/,
    );
    if (!match) return undefined;
    const start = chinese[match[1]] ?? Number(match[1]);
    const end = chinese[match[2]] ?? Number(match[2] ?? start);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start)
      return undefined;
    spans.push({ start, end });
  }
  return continuousSpan(spans);
}

function dayInHeader(text: string): number | undefined {
  const first = text
    .trim()
    .split(/[\n(（]/)[0]
    .trim();
  // Bare numbers in a calendar must not be interpreted as weekday headings.
  return /^[1-7]$/.test(first) ? undefined : parseImportDay(first);
}

export function draftFromText(text: string, source: string): CourseDraft {
  const draft = createEmptyDraft(source);
  draft.rawText = text;
  const clean = normalize(text).replace(/\r/g, '').trim();
  const labelledWeeks = clean.match(/(?:(?:上课)?周次|weeks?)\s*[:：]\s*([^\n;；]+)/i)?.[1].trim();
  const weekMatches = [...clean.matchAll(weekPattern)].map((match) => match[0]);
  if (labelledWeeks) draft.weeks = labelledWeeks;
  else if (weekMatches.length === 1) draft.weeks = weekMatches[0];
  else if (weekMatches.length > 1)
    draft.issues.push('此区域包含多组周次，可能有多门课程，请拆分并核对。');
  else draft.issues.push('未识别到周次，请补充；不会默认为整学期。');
  const periods = [...clean.matchAll(new RegExp(periodPattern.source, 'g'))];
  if (periods.length) {
    const period = periods.length === 1 ? parsePeriodLabel(periods[0][0]) : undefined;
    if (period) {
      draft.start = String(period.start);
      draft.end = String(period.end);
    } else draft.issues.push('节次包含不连续或多组安排，请拆分课程并填写开始、结束节次。');
  }
  const day = clean.match(/(?:星期|周|礼拜)[一二三四五六日天]/)?.[0];
  if (day) draft.day = String(parseImportDay(day));
  const teacher = clean.match(/(?:任课教师|教师|老师)\s*[:：]\s*([^\n;；]+)/);
  const room = clean.match(/(?:上课地点|地点|教室)\s*[:：]\s*([^\n;；]+)/);
  if (teacher) draft.teacher = teacher[1].trim();
  if (room) draft.room = room[1].trim();
  const name = clean.match(/(?:课程名称|课程名|课程)\s*[:：]\s*([^\n;；]+)/);
  if (name) draft.name = name[1].trim();
  else {
    draft.name =
      clean
        .split('\n')
        .map((line) => line.trim())
        .find((line) => {
          return (
            line &&
            !/^(?:任课教师|教师|老师|上课地点|地点|教室|周次)\s*[:：]/.test(line) &&
            !line.match(periodPattern) &&
            !line.match(weekPattern) &&
            !dayInHeader(line)
          );
        }) ?? '';
  }
  return draft;
}

const aliases: Record<string, string[]> = {
  name: ['课程名称', '课程名', '课程', '科目', 'name', 'course'],
  teacher: ['任课教师', '教师', '老师', 'teacher'],
  room: ['教室', '上课地点', '地点', 'room', 'location'],
  day: ['星期', '上课星期', '星期几', '周几', 'day', 'weekday'],
  start: ['开始节次', '起始节次', '开始节', 'start'],
  end: ['结束节次', '结束节', 'end'],
  periods: ['节次', '上课节次', '时间节次', 'periods'],
  weeks: ['上课周次', '教学周', '周次', '周数', 'weeks'],
};

function parseList(cells: GridCell[], source: string): CourseDraft[] | undefined {
  const rows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b);
  let headerRow = -1;
  let columns: Record<string, number> = {};
  for (const row of rows.slice(0, 30)) {
    const found: Record<string, number> = {};
    for (const cell of cells.filter((item) => item.row === row)) {
      const label = cell.text.trim().replace(/\s+/g, '').toLowerCase();
      for (const [field, values] of Object.entries(aliases))
        if (values.includes(label)) found[field] = cell.column;
    }
    if ('name' in found && ('day' in found || 'weeks' in found || 'periods' in found)) {
      headerRow = row;
      columns = found;
      break;
    }
  }
  if (headerRow < 0) return undefined;
  const values = new Map<number, Record<string, string>>();
  const rowText = new Map<number, string[]>();
  const fieldsByColumn = new Map(Object.entries(columns).map(([field, column]) => [column, field]));
  for (const cell of cells) {
    if (cell.row <= headerRow) continue;
    const raw = rowText.get(cell.row) ?? [];
    raw.push(cell.text);
    rowText.set(cell.row, raw);
    const field = fieldsByColumn.get(cell.column);
    if (!field) continue;
    for (let row = cell.row; row < cell.row + (cell.rowSpan ?? 1); row++) {
      const record = values.get(row) ?? {};
      record[field] = cell.text.trim();
      values.set(row, record);
    }
  }
  const drafts: CourseDraft[] = [];
  for (const row of rows.filter((row) => row > headerRow)) {
    const read = (field: string) => values.get(row)?.[field] ?? '';
    if (
      !['name', 'day', 'start', 'end', 'periods', 'weeks', 'teacher', 'room'].some((field) =>
        read(field),
      )
    )
      continue;
    const draft = createEmptyDraft(`${source} · 第 ${row + 1} 行`);
    for (const field of ['name', 'teacher', 'room', 'weeks', 'day', 'start', 'end'] as const)
      draft[field] = read(field);
    if (draft.day) draft.day = String(parseImportDay(draft.day) ?? draft.day);
    const span = parsePeriodLabel(read('periods'));
    if (span) {
      draft.start = String(span.start);
      draft.end = String(span.end);
    } else if (read('periods')) {
      draft.start = '';
      draft.end = '';
      draft.issues.push('此行的节次不连续或无法完整识别，请拆分课程并核对节次。');
    }
    draft.rawText = rowText.get(row)?.join(' | ') ?? '';
    if (!draft.weeks) draft.issues.push('此行未提供上课周次，请补充。');
    drafts.push(draft);
  }
  return drafts;
}

export function parseGrid(cells: GridCell[], source: string): CourseDraft[] {
  const list = parseList(cells, source);
  if (list) return list;
  const headings = cells
    .map((cell) => ({ ...cell, day: dayInHeader(cell.text) }))
    .filter((cell) => cell.day);
  const headerRows = [...new Set(headings.map((cell) => cell.row))];
  const headerRow = headerRows.sort(
    (a, b) =>
      headings.filter((h) => h.row === b).length - headings.filter((h) => h.row === a).length,
  )[0];
  const days = headings
    .filter((cell) => cell.row === headerRow)
    .sort((a, b) => a.column - b.column);
  if (days.length < 2) return [];
  const periods = cells
    .filter((cell) => cell.row > headerRow && cell.column < days[0].column)
    .map((cell) => ({ ...cell, span: parsePeriodLabel(cell.text) }))
    .filter((cell) => cell.span);
  const drafts: CourseDraft[] = [];
  for (const cell of cells) {
    if (cell.row <= headerRow || cell.column < days[0].column || !cell.text.trim()) continue;
    const day = [...days].reverse().find((header) => header.column <= cell.column);
    if (!day) continue;
    const text = cell.text.trim();
    if (/^(?:备注|说明|注意|学期|总计|合计)[:：]/.test(text)) continue;
    const spans = periods.filter(
      (period) =>
        period.row < cell.row + (cell.rowSpan ?? 1) &&
        period.row + (period.rowSpan ?? 1) > cell.row,
    );
    if (!spans.length) continue;
    const draft = draftFromText(
      text,
      `${source} · 第 ${cell.row + 1} 行，第 ${cell.column + 1} 列`,
    );
    const crossedDays = days.filter(
      (header) =>
        header.column > cell.column && header.column < cell.column + (cell.columnSpan ?? 1),
    );
    if (crossedDays.length) draft.issues.push('合并区域跨越多个星期，请核对星期并拆分课程。');
    else if (!draft.day) draft.day = String(day.day);
    if (!draft.start && !draft.end && !text.match(periodPattern)) {
      const span = continuousSpan(spans.map((period) => period.span!));
      if (span) {
        draft.start = String(span.start);
        draft.end = String(span.end);
      } else draft.issues.push('合并区域覆盖的节次不连续，请拆分课程并核对节次。');
    }
    draft.color = colors[(day.day! - 1) % colors.length];
    drafts.push(draft);
  }
  return drafts;
}

function textRows(items: PositionedText[]): PositionedText[][] {
  const rows: PositionedText[][] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(
      (row) =>
        Math.abs(row[0].y + row[0].height / 2 - item.y - item.height / 2) <=
        Math.max(3, Math.max(row[0].height, item.height) * 0.6),
    );
    if (row) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

export function parsePositionedText(items: PositionedText[], source: string): CourseDraft[] {
  const tokens = items
    .filter((item) => item.text.trim() && Number.isFinite(item.x) && Number.isFinite(item.y))
    .flatMap((item) => {
      // Some PDF generators place every weekday in one positioned text item.
      const matches = [...item.text.matchAll(/(?:星期|周|礼拜)[一二三四五六日天]/g)];
      if (matches.length < 2 || item.text.replace(/(?:星期|周|礼拜)[一二三四五六日天]/g, '').trim())
        return [item];
      return matches.map((match) => ({
        ...item,
        text: match[0],
        x: item.x + (item.width * match.index) / item.text.length,
        width: (item.width * match[0].length) / item.text.length,
      }));
    });
  const rows = textRows(tokens);
  // Join adjacent pieces such as OCR's separate “星期” and “一”.
  const joined = rows.map((row) => {
    const result: PositionedText[] = [];
    for (let i = 0; i < row.length; i++) {
      const first = row[i],
        next = row[i + 1];
      if (
        /^(?:星期|周|礼拜)$/.test(first.text.trim()) &&
        next &&
        /^[一二三四五六日天]$/.test(next.text.trim()) &&
        next.x - first.x - first.width < first.height * 2
      ) {
        result.push({
          ...first,
          text: first.text.trim() + next.text.trim(),
          width: next.x + next.width - first.x,
        });
        i++;
      } else result.push(first);
    }
    return result;
  });
  const heading =
    joined
      .map((row) =>
        row.map((item) => ({ ...item, day: dayInHeader(item.text) })).filter((item) => item.day),
      )
      .sort((a, b) => b.length - a.length)[0] ?? [];
  if (heading.length < 2)
    return parseTextBlocks(
      rows.map((row) => row.map((token) => token.text).join(' ')).join('\n'),
      source,
    );
  heading.sort((a, b) => a.x - b.x);
  const centers = heading.map((item) => item.x + item.width / 2);
  const widths = centers.slice(1).map((x, i) => x - centers[i]);
  const columnWidth = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  const left = centers[0] - columnWidth / 2;
  const top = Math.max(...heading.map((item) => item.y + item.height));
  const periodTokens = joined
    .flat()
    .filter((item) => item.x + item.width <= left && item.y > top)
    .map((item) => ({ ...item, span: parsePeriodLabel(item.text) }))
    .filter((item) => item.span)
    .sort((a, b) => a.y - b.y);
  const drafts: CourseDraft[] = [];
  for (let dayIndex = 0; dayIndex < heading.length; dayIndex++) {
    const x0 = dayIndex ? (centers[dayIndex - 1] + centers[dayIndex]) / 2 : left;
    const x1 =
      dayIndex + 1 < centers.length
        ? (centers[dayIndex] + centers[dayIndex + 1]) / 2
        : centers[dayIndex] + columnWidth / 2;
    const column = tokens.filter(
      (item) => item.y > top && item.x + item.width / 2 >= x0 && item.x + item.width / 2 < x1,
    );
    const lines = textRows(column).map((row) => ({
      text: row.map((item) => item.text.trim()).join(' '),
      y: Math.min(...row.map((item) => item.y)),
      bottom: Math.max(...row.map((item) => item.y + item.height)),
      height: Math.max(...row.map((item) => item.height)),
      confidence: Math.min(...row.map((item) => item.confidence ?? 100)),
    }));
    const chunks: (typeof lines)[] = [];
    for (const line of lines) {
      const chunk = chunks.at(-1);
      const last = chunk?.at(-1);
      if (!last || line.y - last.bottom > Math.max(last.height, line.height) * 1.8)
        chunks.push([line]);
      else chunk!.push(line);
    }
    for (const chunk of chunks) {
      const raw = chunk.map((line) => line.text).join('\n');
      if (/^(?:备注|说明|注意|学期|总计|合计)[:：]/.test(raw)) continue;
      const draft = draftFromText(
        raw,
        `${source} · 星期${'一二三四五六日'[heading[dayIndex].day! - 1]}`,
      );
      draft.day ||= String(heading[dayIndex].day);
      draft.confidence = Math.min(...chunk.map((line) => line.confidence));
      if (draft.confidence < 75) draft.issues.push('部分文字识别置信度较低，请对照原图核对。');
      if (!draft.start && !draft.end && !raw.match(periodPattern)) {
        // Infer only inside the bounded area of multiple nearby, ordered row labels.
        // A nearest label alone is not evidence that distant text belongs to that period.
        const centers = periodTokens.map((item) => item.y + item.height / 2);
        const gaps = centers.slice(1).map((center, index) => center - centers[index]);
        const regular =
          gaps.length > 0 &&
          gaps.every(
            (gap, index) =>
              gap > 0 &&
              gap <=
                Math.max(
                  48,
                  Math.max(periodTokens[index].height, periodTokens[index + 1].height) * 8,
                ),
          );
        const inside =
          regular &&
          chunk[0].y >= centers[0] - gaps[0] / 2 &&
          chunk.at(-1)!.bottom <= centers.at(-1)! + gaps.at(-1)! / 2;
        if (inside) {
          const closest = (y: number) =>
            centers.reduce(
              (best, center, index) =>
                Math.abs(center - y) < Math.abs(centers[best] - y) ? index : best,
              0,
            );
          const first = closest(chunk[0].y),
            last = closest(chunk.at(-1)!.bottom);
          const span = continuousSpan(
            periodTokens.slice(first, last + 1).map((item) => item.span!),
          );
          if (span) {
            draft.start = String(span.start);
            draft.end = String(span.end);
            draft.issues.push('节次依据相邻表格行识别，请对照原图核对。');
          }
        }
        if (!draft.start)
          draft.issues.push('无法确定课程对应的节次区域，请手动补充开始、结束节次。');
      }
      draft.color = colors[dayIndex % colors.length];
      if (draft.name) drafts.push(draft);
    }
  }
  return drafts;
}

export function parseTextBlocks(text: string, source: string): CourseDraft[] {
  const blocks = text.split(/\n\s*\n|\n[-─]{3,}\n/).filter((block) => block.trim());
  return blocks
    .map((block, index) => draftFromText(block, `${source} · 区域 ${index + 1}`))
    .filter((draft) => draft.name || draft.weeks);
}

export function normalizedWeekText(input: string): string {
  try {
    return formatWeeks(parseImportWeeks(input));
  } catch {
    return input;
  }
}
