import { createEmptyDraft, parseImportWeeks } from './model';
import { formatWeeks } from '../../model';
import { draftFromText } from './parse';
import type { CourseCatalogEntry, CourseDraft } from './model';
import type { OcrText } from './ocr';

/** Join wrapped Chinese glyphs without losing Latin suffixes such as A3. */
export function compactCourseText(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, '')
    .replace(/^[|｜:：]+|[|｜:：]+$/g, '')
    .trim();
}

function score(tokens: OcrText['tokens']): number {
  const weight = tokens.reduce((sum, token) => sum + token.text.trim().length, 0);
  return weight
    ? tokens.reduce((sum, token) => sum + (token.confidence ?? 0) * token.text.trim().length, 0) /
        weight
    : 0;
}

function metadataOffset(text: string): number {
  return text
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10))
    .search(
      /(?:任课教师|教师|老师|上课地点|地点|教室|(?:上课)?周次|weeks?|(?:上课)?节次)\s*[:：]|(?<![\d,，、\-~～—–至])(?:第\s*)?\d{1,2}(?:\s*[-~～—–至,，、]\s*\d{1,2})*\s*(?:周(?!次)|节(?!次)|[（(][单双]周?[)）])/i,
    );
}

/** Read only location lines, including wrapped rooms, from a card/room ROI. */
export function compactRoomText(text: string): string {
  const lines = text
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const at = lines.findIndex((line) => /[@＠]/.test(line));
  const parts: string[] = [];
  for (const [index, line] of lines.slice(Math.max(0, at)).entries()) {
    const value =
      index === 0
        ? line.replace(/^.*?[@＠]/, '').replace(/^(?:上课地点|地点|教室)\s*[:：]/, '')
        : line;
    const metadata = metadataOffset(value);
    parts.push(metadata >= 0 ? value.slice(0, metadata) : value);
    if (metadata >= 0) break;
  }
  return compactCourseText(parts.join('')).replace(/[;；,，、|｜]+$/, '');
}

export function uniqueCatalogMatch(
  name: string,
  catalog: CourseCatalogEntry[],
): CourseCatalogEntry | undefined {
  const matches = catalog.filter(
    (entry) =>
      compactCourseText(entry.name).toLowerCase() === compactCourseText(name).toLowerCase(),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function cardSections(result: OcrText, catalog: CourseCatalogEntry[]) {
  const lines = result.text
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const at = lines.findIndex((line) => /[@＠]/.test(line));
  const metadata = lines.findIndex((line) => metadataOffset(line) >= 0);
  let split = Math.min(at >= 0 ? at : lines.length, metadata >= 0 ? metadata : lines.length);
  // A missing @ must not turn a uniquely matched title plus location into a title.
  for (let count = 1; count <= split; count++) {
    if (uniqueCatalogMatch(compactCourseText(lines.slice(0, count).join('')), catalog)) {
      split = count;
      break;
    }
  }
  return { lines, split, at };
}

export function cardDraft(
  result: OcrText,
  source: string,
  placement: { day: number; start: number; end: number } | null,
  catalog: CourseCatalogEntry[],
): CourseDraft {
  const draft = createEmptyDraft(source);
  const { lines, at, split } = cardSections(result, catalog);
  draft.name = compactCourseText(lines.slice(0, split).join(''));
  draft.room = at >= 0 ? compactRoomText(lines.slice(at).join('\n')) : '';
  const boundary = at >= 0 ? result.tokens.find((token) => /[@＠]/.test(token.text))?.y : undefined;
  const metadataY = result.tokens
    .filter((token) => metadataOffset(token.text) >= 0)
    .map((token) => token.y)
    .sort((a, b) => a - b)[0];
  const nameBoundary = Math.min(boundary ?? Infinity, metadataY ?? Infinity);
  const roomEnd =
    result.tokens
      .filter(
        (token) => boundary !== undefined && token.y >= boundary && metadataOffset(token.text) >= 0,
      )
      .map((token) => token.y)
      .sort((a, b) => a - b)[0] ?? Infinity;
  const nameTokens = Number.isFinite(nameBoundary)
    ? result.tokens.filter((token) => token.y < nameBoundary)
    : result.tokens;
  const roomTokens =
    boundary === undefined
      ? []
      : result.tokens.filter((token) => token.y >= boundary && token.y < roomEnd);
  draft.fieldConfidence = {
    name: nameTokens.length ? score(nameTokens) : result.confidence,
    room: roomTokens.length ? score(roomTokens) : result.confidence,
    day: placement ? 100 : 0,
    periods: placement ? 100 : 0,
  };
  draft.layout = 'grid';
  draft.rawText = result.text;
  draft.confidence = result.confidence;
  if (placement) {
    draft.day = String(placement.day);
    draft.start = String(placement.start);
    draft.end = String(placement.end);
  } else draft.blockingIssues = ['无法可靠确定星期或完整节次，请补录。'];
  // This text belongs to a card ROI, so explicit single/list/parity week rules
  // are course rules. The whole screenshot heading is never included here.
  const weekDraft = draftFromText(lines.slice(split).join('\n'), source);
  if (weekDraft.weeks) {
    try {
      draft.weeks = formatWeeks(parseImportWeeks(weekDraft.weeks));
    } catch {
      // Keep an explicit invalid rule so validation rejects it instead of
      // silently replacing it with all semester weeks.
      draft.weeks = weekDraft.weeks;
    }
  }
  if (weekDraft.issues.some((issue) => issue.includes('多组周次')))
    draft.blockingIssues = [...(draft.blockingIssues ?? []), '课程格包含多组周次，请拆分并补录。'];
  const entry = uniqueCatalogMatch(draft.name, catalog);
  if (entry) {
    draft.name = entry.name;
    draft.teacher = entry.teacher;
    draft.fieldConfidence.teacher = entry.fieldConfidence.teacher;
    draft.fieldConfidence.name = Math.max(
      draft.fieldConfidence.name ?? 0,
      entry.fieldConfidence.name ?? 0,
    );
    if (!entry.teacher) draft.issues.push('目录中的教师识别不可靠，已留空。');
  }
  if (draft.room && (draft.fieldConfidence.room ?? 0) < 75) {
    draft.room = '';
    draft.issues.push('教室识别分数低于 75，已留空。');
  }
  return draft;
}
