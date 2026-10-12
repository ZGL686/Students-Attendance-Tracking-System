import { describe, expect, it } from 'vitest';
import { cachedCatalogField } from '../src/features/timetable-import/catalog-field';
import type { OcrText } from '../src/features/timetable-import/ocr';
import type { PositionedText } from '../src/features/timetable-import/parse';

const rect = { x: 100, y: 40, width: 160, height: 30 };
const token = (changes: Partial<PositionedText> = {}): PositionedText => ({
  text: '虚构',
  x: 110,
  y: 46,
  width: 32,
  height: 18,
  confidence: 95,
  ...changes,
});
const scan = (tokens: PositionedText[]): OcrText => ({
  text: '全表内容不作为字段文本',
  tokens,
  confidence: 98,
});

describe('complete cached catalog field', () => {
  it('uses complete high-confidence cell words in horizontal order', () => {
    const first = token();
    const second = token({ text: '课程A3', x: 149, width: 65, confidence: 99 });
    const tokens = [second, first];
    const cached = cachedCatalogField(scan(tokens), rect);
    expect(cached?.text).toBe('虚构课程A3');
    expect(cached?.tokens).toEqual([first, second]);
    expect(tokens).toEqual([second, first]);
    expect(cached?.confidence).toBeCloseTo((95 * 2 + 99 * 4) / 6);
  });

  it.each([89.99, 0, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'falls back when any cell token has an unreliable confidence of %s',
    (confidence) => {
      expect(
        cachedCatalogField(scan([token(), token({ x: 149, text: '课程', confidence })]), rect),
      ).toBeUndefined();
    },
  );

  it('accepts the high-confidence threshold exactly', () => {
    expect(cachedCatalogField(scan([token({ confidence: 90 })]), rect)?.confidence).toBe(90);
  });

  it('ignores neighboring cells and other rows even when their confidence is unreliable', () => {
    const kept = token();
    const neighbors = [
      token({ x: 70, width: 10, confidence: undefined }),
      token({ x: 270, width: 10, confidence: 1 }),
      token({ y: 15, height: 10, confidence: Number.NaN }),
      token({ y: 80, height: 10, confidence: 1 }),
    ];
    expect(cachedCatalogField(scan([kept, ...neighbors]), rect)).toEqual({
      text: '虚构',
      tokens: [kept],
      confidence: 95,
    });
  });

  it.each([
    { x: 96.99, width: 20 },
    { x: 240, width: 23.01 },
  ])('rejects a clipped cell token that extends beyond its margin: %j', (bounds) => {
    expect(cachedCatalogField(scan([token(bounds)]), rect)).toBeUndefined();
  });

  it.each([
    { x: 97, width: 20 },
    { x: 243, width: 20 },
  ])('accepts an unclipped cell token at the 3 pixel margin: %j', (bounds) => {
    expect(cachedCatalogField(scan([token(bounds)]), rect)?.text).toBe('虚构');
  });

  it('does not substitute the full table text for an empty cell', () => {
    expect(cachedCatalogField(scan([]), rect)).toBeUndefined();
    expect(cachedCatalogField(scan([token({ x: 270 })]), rect)).toBeUndefined();
  });
});
