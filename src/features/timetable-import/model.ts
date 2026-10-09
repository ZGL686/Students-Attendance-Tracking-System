import type { Course } from '../../model';
import { courseSchema, uid } from '../../model';

export type CourseDraft = {
  id: string;
  name: string;
  teacher: string;
  room: string;
  day: string;
  start: string;
  end: string;
  weeks: string;
  color: Course['color'];
  source: string;
  issues: string[];
  layout?: 'grid' | 'list' | 'text';
  rawText?: string;
  confidence?: number;
};
export type ImportMode = 'append' | 'replace';
export type DraftIssue = { draftId: string; message: string };
export type ImportSource = { index: number; label: string };
export type ImportProgress = { stage: string; progress: number };
export type ReadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  selection?: number[];
};
export type ImportResult = {
  drafts: CourseDraft[];
  sources: ImportSource[];
  warnings: string[];
};

export function createEmptyDraft(source = '手动补充'): CourseDraft {
  return {
    id: uid(),
    name: '',
    teacher: '',
    room: '',
    day: '',
    start: '',
    end: '',
    weeks: '',
    color: 'blue',
    source,
    issues: [],
  };
}

/** Accept ranges with optional odd/even qualifiers; never infer an absent range. */
export function parseImportWeeks(input: string): number[] {
  const text = input
    .trim()
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10))
    .replace(/^(?:上课)?周次\s*[:：]?\s*/, '')
    .replace(/[第\s]/g, '')
    .replace(/[～~—–至]/g, '-')
    .replace(/[，、;；]/g, ',')
    .replace(/[（【]/g, '(')
    .replace(/[）】]/g, ')')
    .replace(/周/g, '');
  if (!text) throw new Error('请填写上课周次，识别时不会默认整学期。');
  const result = new Set<number>();
  // A qualifier after a range-list applies to that entire list: 1-8,10-16(单).
  const global = text.match(/^([\d,-]+)\(?([单双])\)?$/);
  const segments = (global ? global[1] : text).split(',');
  for (const part of segments) {
    const match = part.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\(?([单双])\)?)?$/);
    if (!match) throw new Error('周次格式示例：1-16、1-8,10-16、1-16(单)。');
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    const parity = match[3] ?? global?.[2];
    if (start < 1 || end > 30 || end < start) throw new Error('周次需在 1–30 内，结束不小于开始。');
    for (let week = start; week <= end; week++) {
      if (!parity || week % 2 === (parity === '单' ? 1 : 0)) result.add(week);
    }
  }
  if (!result.size) throw new Error('周次范围与单双周条件不匹配。');
  return [...result].sort((a, b) => a - b);
}

export function parseImportDay(input: string): number | undefined {
  const text = input.trim().replace(/\s+/g, '').toLowerCase();
  if (/^[1-7]$/.test(text)) return Number(text);
  const match = text.match(/^(?:星期|周|礼拜)([一二三四五六日天1-7])$/);
  if (match) return '一二三四五六日'.indexOf(match[1].replace('天', '日')) + 1 || Number(match[1]);
  const english = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const index = english.findIndex((day) => text === day || text === day.slice(0, 3));
  return index < 0 ? undefined : index + 1;
}

export function coursesOverlap(a: Course, b: Course): boolean {
  return (
    a.day === b.day &&
    a.start <= b.end &&
    a.end >= b.start &&
    a.weeks.some((week) => b.weeks.includes(week))
  );
}

export function courseFingerprint(course: Course): string {
  return JSON.stringify([
    course.name.trim(),
    course.teacher.trim(),
    course.room.trim(),
    course.day,
    course.start,
    course.end,
    [...new Set(course.weeks)].sort((a, b) => a - b),
  ]);
}

/** Returns only the courses to insert, not the existing timetable. */
export function validateDrafts(
  drafts: CourseDraft[],
  existing: Course[],
  mode: ImportMode,
  totalWeeks = 30,
): { courses: Course[]; issues: DraftIssue[]; duplicates: number } {
  const issues: DraftIssue[] = [];
  const courses: Course[] = [];
  const retained = mode === 'append' ? existing : [];
  const seen = new Set(retained.map(courseFingerprint));
  let duplicates = 0;
  for (const draft of drafts) {
    const complain = (message: string) => issues.push({ draftId: draft.id, message });
    const name = draft.name.trim();
    if (!name) {
      complain('请填写课程名称。');
      continue;
    }
    const day = parseImportDay(draft.day);
    if (!day || day < 1 || day > 7) {
      complain('请选择星期一至星期日。');
      continue;
    }
    if (!/^\d{1,2}$/.test(draft.start.trim()) || !/^\d{1,2}$/.test(draft.end.trim())) {
      complain('请填写开始和结束节次。');
      continue;
    }
    let weeks: number[];
    try {
      weeks = parseImportWeeks(draft.weeks);
    } catch (error) {
      complain(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (weeks.some((week) => week > totalWeeks)) {
      complain(`周次超出当前学期的 ${totalWeeks} 周，请核对或先修改学期设置。`);
      continue;
    }
    const parsed = courseSchema.safeParse({
      id: draft.id,
      name,
      teacher: draft.teacher.trim(),
      room: draft.room.trim(),
      day,
      start: Number(draft.start),
      end: Number(draft.end),
      weeks,
      color: draft.color,
    });
    if (!parsed.success) {
      complain('课程名称不超过 100 字，节次需在 1–10 内，结束不早于开始。');
      continue;
    }
    const course = parsed.data;
    const fingerprint = courseFingerprint(course);
    if (seen.has(fingerprint)) {
      duplicates++;
      continue;
    }
    const overlap = [...retained, ...courses].find((other) => coursesOverlap(course, other));
    if (overlap) {
      complain(`与“${overlap.name}”的星期、节次和周次重叠，请调整或取消选中。`);
      continue;
    }
    // Imported drafts are temporary IDs; avoid colliding with an existing course ID.
    if ([...existing, ...courses].some((other) => other.id === course.id)) course.id = uid();
    courses.push(course);
    seen.add(fingerprint);
  }
  return { courses, issues, duplicates };
}

export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('已取消导入。', 'AbortError');
}

export async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  cancel?: () => void,
): Promise<T> {
  checkAborted(signal);
  if (!signal) return promise;
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    listener = () => {
      cancel?.();
      reject(new DOMException('已取消导入。', 'AbortError'));
    };
    signal.addEventListener('abort', listener, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', listener);
  }
}

export function offlineUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}offline/${path}`, window.location.href).href;
}
