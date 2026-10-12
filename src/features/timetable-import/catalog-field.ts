import type { ImageRect } from './image-layout';
import type { OcrText } from './ocr';

/** Reuse a complete high-score cell already read in the directory scan. */
export function cachedCatalogField(scan: OcrText, rect: ImageRect): OcrText | undefined {
  const tokens = scan.tokens
    .filter(
      (token) =>
        token.x + token.width / 2 >= rect.x &&
        token.x + token.width / 2 <= rect.x + rect.width &&
        token.y + token.height / 2 >= rect.y &&
        token.y + token.height / 2 <= rect.y + rect.height,
    )
    .sort((a, b) => a.x - b.x);
  if (
    !tokens.length ||
    tokens.some(
      (token) =>
        !Number.isFinite(token.confidence) ||
        (token.confidence ?? 0) < 90 ||
        token.x < rect.x - 3 ||
        token.x + token.width > rect.x + rect.width + 3,
    )
  )
    return;
  const text = tokens.map((token) => token.text).join('');
  const weight = tokens.reduce((sum, token) => sum + token.text.length, 0);
  return {
    text,
    tokens,
    confidence:
      tokens.reduce((sum, token) => sum + (token.confidence ?? 0) * token.text.length, 0) /
      Math.max(1, weight),
  };
}
