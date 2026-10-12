import { compactCourseText } from './card-text';
import type { CardTextBand } from './card-layout';
import type { ImageRect } from './image-layout';
import type { OcrText } from './ocr';
import type { OcrEngine } from './ocr-regions';

/** A malformed OCR word box must not discard an otherwise legible room number. */
export async function verifyRoomNumber(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  region: ImageRect,
  last: CardTextBand,
  scans: OcrText[],
  primary: OcrText,
  length: number,
): Promise<string | undefined> {
  const relevant = (token: OcrText['tokens'][number]) =>
    /\d{2,}/.test(token.text) &&
    Math.abs(token.y + token.height / 2 - (last.top + last.bottom) / 2) <
      Math.max(token.height, last.bottom - last.top) * 0.8;
  const tokens = scans
    .flatMap((scan) => scan.tokens)
    .filter(relevant)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const original = [...primary.tokens].reverse().find(relevant);
  const alternatives = [tokens[0], original, ...tokens].filter((token) => token !== undefined);
  const padding = Math.max(3, Math.round(region.width * 0.045));
  const seen = new Set<string>();
  for (const token of alternatives) {
    const x = Math.max(region.x, Math.floor(token.x - padding));
    const y = Math.max(region.y, last.top - padding);
    const rect = {
      x,
      y,
      width: Math.min(region.x + region.width - x, Math.ceil(token.width + 2 * padding)),
      height: Math.min(region.y + region.height, last.bottom + padding + 1) - y,
    };
    if (rect.width < 3 || rect.height < 3) continue;
    const key = JSON.stringify(rect);
    if (seen.has(key)) continue;
    seen.add(key);
    const votes = new Map<string, number>();
    for (const scale of [1, 2, 3]) {
      const result = await engine.scan(canvas, rect, scale, 'digits');
      const digits = compactCourseText(result.text).replace(/^-/, '');
      if (result.confidence >= 75 && /^\d{2,6}$/.test(digits) && digits.length === length) {
        votes.set(digits, (votes.get(digits) ?? 0) + 1);
        if (votes.get(digits)! >= 2) return digits;
      }
    }
    if (seen.size >= 3) break;
  }
}
