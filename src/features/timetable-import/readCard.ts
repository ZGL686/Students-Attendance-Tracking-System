import {
  cardDraft,
  cardSections,
  compactCourseText,
  compactRoomText,
  uniqueCatalogMatch,
} from './card-text';
import { detectCardTextBands, suggestCardSplit } from './card-layout';
import type { CardTextBand } from './card-layout';
import type { ImageRect } from './image-layout';
import type { CourseCatalogEntry } from './model';
import type { OcrText } from './ocr';
import { contrastRegion, retryRegion } from './ocr-regions';
import type { OcrEngine } from './ocr-regions';
import { selectRoomCandidate } from './field-candidates';
import type { FieldCandidate } from './field-candidates';
import { verifyRoomNumber } from './room-number';

function best(results: OcrText[]): OcrText {
  const count = (result: OcrText) =>
    results.filter(
      (candidate) => compactCourseText(candidate.text) === compactCourseText(result.text),
    ).length;
  return [...results].sort(
    (a, b) =>
      (count(b) >= 2 ? count(b) : 0) - (count(a) >= 2 ? count(a) : 0) ||
      b.confidence - a.confidence,
  )[0];
}

function fieldBoundary(
  results: OcrText[],
  catalog: CourseCatalogEntry[],
  bands: CardTextBand[],
): number | undefined {
  if (bands.length > 1) {
    for (const result of results) {
      const token = result.tokens.find((value) => /[@＠]/.test(value.text));
      if (!token) continue;
      const index = bands.reduce(
        (chosen, band, index) =>
          Math.abs(band.top - token.y) < Math.abs(bands[chosen].top - token.y) ? index : chosen,
        0,
      );
      if (index > 0) return (bands[index - 1].bottom + bands[index].top) / 2;
    }
    const suggestion = suggestCardSplit(bands);
    if (suggestion !== undefined) return suggestion;
  }
  for (const result of results) {
    const { lines, split, at } = cardSections(result, catalog);
    if (split === lines.length && at < 0) continue;
    const rows: { y: number; bottom: number; tokens: OcrText['tokens'] }[] = [];
    for (const token of [...result.tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const row = rows.find(
        (entry) =>
          Math.abs(entry.y - token.y) < Math.max(token.height, entry.bottom - entry.y) * 0.55,
      );
      if (row) {
        row.tokens.push(token);
        row.bottom = Math.max(row.bottom, token.y + token.height);
      } else rows.push({ y: token.y, bottom: token.y + token.height, tokens: [token] });
    }
    const atRow = rows.findIndex((row) => row.tokens.some((token) => /[@＠]/.test(token.text)));
    const firstRoom = atRow >= 0 ? atRow : split;
    if (firstRoom > 0 && rows[firstRoom])
      return (rows[firstRoom - 1].bottom + rows[firstRoom].y) / 2;
  }
}

export async function readCard(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  region: ImageRect,
  source: string,
  placement: { day: number; start: number; end: number } | null,
  catalog: CourseCatalogEntry[],
) {
  const candidates = await retryRegion(engine, canvas, region, false, true);
  const colorCardCount = candidates.length;
  candidates.push(...(await contrastRegion(engine, canvas, region, true)));
  const drafts = candidates.map((result) => cardDraft(result, source, placement, catalog));
  const chosen =
    drafts.find((draft) => uniqueCatalogMatch(draft.name, catalog)) ??
    cardDraft(best(candidates), source, placement, catalog);
  const pixels = canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height);
  const bands = detectCardTextBands(pixels, region);
  const boundary = fieldBoundary(candidates, catalog, bands);
  if (boundary === undefined || boundary <= region.y || boundary >= region.y + region.height)
    return chosen;
  // Retry the fields themselves: a large card's overall score can hide small text errors.
  const split = Math.round(boundary);
  const padding = Math.max(3, Math.round(region.width * 0.045));
  const textTop = bands.length ? Math.max(region.y, bands[0].top - padding) : region.y;
  const textBottom = bands.length
    ? Math.min(region.y + region.height, bands.at(-1)!.bottom + padding + 1)
    : region.y + region.height;
  const names = await retryRegion(
    engine,
    canvas,
    {
      ...region,
      y: textTop,
      height: split - textTop,
    },
    false,
    true,
  );
  const rooms = await retryRegion(
    engine,
    canvas,
    {
      ...region,
      y: split,
      height: textBottom - split,
    },
    false,
    true,
  );
  const colorRoomCount = rooms.length;
  rooms.push(
    ...(await contrastRegion(
      engine,
      canvas,
      { ...region, y: split, height: textBottom - split },
      true,
    )),
  );
  const name =
    names.find((result) => uniqueCatalogMatch(compactCourseText(result.text), catalog)) ??
    best(names);
  const reference = uniqueCatalogMatch(compactCourseText(name.text), catalog);
  if (reference || !uniqueCatalogMatch(chosen.name, catalog)) {
    chosen.name = reference?.name ?? compactCourseText(name.text);
    chosen.fieldConfidence = {
      ...chosen.fieldConfidence,
      name: Math.max(name.confidence, reference?.fieldConfidence.name ?? 0),
    };
    chosen.teacher = reference?.teacher ?? '';
    chosen.fieldConfidence.teacher = reference?.fieldConfidence.teacher;
  }
  const roomCandidates: FieldCandidate[] = rooms.map((room, index) => ({
    text: compactRoomText(room.text),
    confidence: room.confidence,
    anchored: /[@＠]/.test(room.text),
    family: index < colorRoomCount ? 'color-room' : 'contrast-room',
  }));
  for (const [index, draft] of drafts.entries()) {
    if (draft.room)
      roomCandidates.push({
        text: draft.room,
        confidence: draft.fieldConfidence?.room ?? 0,
        anchored: /[@＠]/.test(draft.rawText ?? ''),
        family: index < colorCardCount ? 'color-card' : 'contrast-card',
      });
  }
  const room = selectRoomCandidate(roomCandidates);
  chosen.fieldConfidence = {
    ...chosen.fieldConfidence,
    room: room?.confidence ?? best(rooms).confidence,
  };
  chosen.room = room?.text ?? '';
  chosen.issues = chosen.issues.filter(
    (issue) => !issue.includes('教室识别') && !issue.includes('目录中的教师'),
  );
  if (!room) chosen.issues.push('教室识别分数低于 75，已留空。');
  if (reference && !reference.teacher) chosen.issues.push('目录中的教师识别不可靠，已留空。');
  // Latin digits are independently checked with the bundled English model.
  const lastBand = bands.at(-1);
  const suffix = chosen.room.match(/[-－](\d{2,6})$/);
  if (suffix && lastBand) {
    const digits = await verifyRoomNumber(
      engine,
      canvas,
      region,
      lastBand,
      [...rooms, ...candidates],
      candidates[0],
      suffix[1].length,
    );
    if (digits) chosen.room = chosen.room.replace(/[-－]\d{2,6}$/, `-${digits}`);
    else {
      chosen.room = '';
      chosen.fieldConfidence.room = 0;
      chosen.issues.push('房号局部复核不一致，教室已留空。');
    }
  }
  return chosen;
}
