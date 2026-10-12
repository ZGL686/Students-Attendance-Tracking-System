import { compactCourseText, uniqueCatalogMatch } from './card-text';
import { parseImportDay, parseImportWeeks } from './model';
import type { CourseCatalogEntry, CourseDraft, FieldConfidence } from './model';

function reliable(value: number | undefined, minimum: number): boolean {
  return value !== undefined && Number.isFinite(value) && value >= minimum && value <= 100;
}

function completePlacement(draft: CourseDraft): boolean {
  if (
    typeof draft.day !== 'string' ||
    typeof draft.start !== 'string' ||
    typeof draft.end !== 'string' ||
    !/^\d{1,2}$/.test(draft.start.trim()) ||
    !/^\d{1,2}$/.test(draft.end.trim())
  )
    return false;
  const day = parseImportDay(draft.day);
  const start = Number(draft.start);
  const end = Number(draft.end);
  return day !== undefined && day >= 1 && day <= 7 && start >= 1 && end <= 10 && end >= start;
}

function weekKey(weeks: string): string | undefined {
  if (typeof weeks !== 'string') return undefined;
  if (!weeks.trim()) return '';
  try {
    return parseImportWeeks(weeks).join(',');
  } catch {
    return undefined;
  }
}

/** Only clear, independently agreeing scans may avoid the complete regional retries. */
export function canUseCardFastPath(
  a: CourseDraft,
  b: CourseDraft,
  catalog: CourseCatalogEntry[],
): boolean {
  for (const draft of [a, b]) {
    if (
      typeof draft.name !== 'string' ||
      typeof draft.room !== 'string' ||
      typeof draft.rawText !== 'string' ||
      !/[@＠]/.test(draft.rawText) ||
      !draft.room.trim() ||
      draft.name.trim().length > 100 ||
      draft.blockingIssues?.length ||
      !completePlacement(draft)
    )
      return false;
    for (const [field, minimum] of [
      ['name', 75],
      ['room', 85],
      ['day', 75],
      ['periods', 75],
    ] as const satisfies ReadonlyArray<readonly [keyof FieldConfidence, number]>)
      if (!reliable(draft.fieldConfidence?.[field], minimum)) return false;
  }
  const name = compactCourseText(a.name).toLowerCase();
  if (!name || name !== compactCourseText(b.name).toLowerCase() || a.room.trim() !== b.room.trim())
    return false;
  const entry = uniqueCatalogMatch(a.name, catalog);
  if (!entry || !reliable(entry.fieldConfidence.name, 75)) return false;
  const aWeeks = weekKey(a.weeks);
  const bWeeks = weekKey(b.weeks);
  return (
    parseImportDay(a.day) === parseImportDay(b.day) &&
    Number(a.start) === Number(b.start) &&
    Number(a.end) === Number(b.end) &&
    aWeeks !== undefined &&
    aWeeks === bWeeks
  );
}
