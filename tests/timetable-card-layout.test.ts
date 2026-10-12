import { describe, expect, it } from 'vitest';
import {
  detectCardTextBands,
  suggestCardSplit,
} from '../src/features/timetable-import/card-layout';
import type { ImageRect, PixelImage } from '../src/features/timetable-import/image-layout';

function fixture(scale = 1) {
  const image: PixelImage = {
    width: Math.round(300 * scale),
    height: Math.round(340 * scale),
    data: new Uint8ClampedArray(Math.round(300 * scale) * Math.round(340 * scale) * 4),
  };
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = 40;
    image.data[offset + 1] = 100;
    image.data[offset + 2] = 220;
    image.data[offset + 3] = 255;
  }
  const paint = (x: number, y: number, width: number, height: number, color = [245, 245, 245]) => {
    for (let row = Math.round(y * scale); row < Math.round((y + height) * scale); row++) {
      for (let column = Math.round(x * scale); column < Math.round((x + width) * scale); column++) {
        const offset = (row * image.width + column) * 4;
        image.data[offset] = color[0];
        image.data[offset + 1] = color[1];
        image.data[offset + 2] = color[2];
      }
    }
  };
  // Fictional glyphs contain separated strokes; the white border is not lettering.
  paint(40, 30, 160, 2);
  paint(40, 318, 160, 2);
  paint(40, 30, 2, 290);
  paint(198, 30, 2, 290);
  for (const y of [50, 92, 159, 201, 243]) {
    paint(60, y, 40, 5);
    paint(60, y + 10, 40, 5);
    paint(60, y + 16, 40, 5);
  }
  paint(60, 10, 60, 10);
  const region: ImageRect = {
    x: 40 * scale,
    y: 30 * scale,
    width: 160 * scale,
    height: 290 * scale,
  };
  return { image, region, paint };
}

describe('colored card text geometry', () => {
  it('merges disconnected white strokes into text rows and excludes the card border', () => {
    const { image, region } = fixture();
    const bands = detectCardTextBands(image, region);
    expect(bands).toEqual([
      { top: 50, bottom: 70 },
      { top: 92, bottom: 112 },
      { top: 159, bottom: 179 },
      { top: 201, bottom: 221 },
      { top: 243, bottom: 263 },
    ]);
    expect(suggestCardSplit(bands)).toBe(135.5);
  });

  it.each([0.5, 2])('retains original-image coordinates when scaled by %s', (scale) => {
    const { image, region } = fixture(scale);
    const bands = detectCardTextBands(image, region);
    expect(bands).toHaveLength(5);
    expect(bands[0].top / scale).toBeCloseTo(50);
    expect(bands[0].bottom / scale).toBeGreaterThanOrEqual(69);
    expect(bands[0].bottom / scale).toBeLessThanOrEqual(71);
    expect(suggestCardSplit(bands)! / scale).toBeGreaterThanOrEqual(135);
    expect(suggestCardSplit(bands)! / scale).toBeLessThanOrEqual(136);
  });

  it('ignores bright saturated pixels and isolated white speckles', () => {
    const { image, region, paint } = fixture();
    paint(60, 135, 70, 2, [255, 220, 220]);
    paint(60, 138, 2, 1);
    expect(detectCardTextBands(image, region)).toHaveLength(5);
  });

  it('clamps cropped rectangles to the image and rejects empty interiors', () => {
    const { image } = fixture();
    expect(() =>
      detectCardTextBands(image, { x: -10, y: -5, width: 400, height: 300 }),
    ).not.toThrow();
    expect(detectCardTextBands(image, { x: 50, y: 50, width: 3, height: 3 })).toEqual([]);
    expect(detectCardTextBands(image, { x: 500, y: 400, width: 30, height: 30 })).toEqual([]);
  });

  it('does not suggest a split for regular spacing, ambiguous gaps, or fragmented glyphs', () => {
    expect(suggestCardSplit([])).toBeUndefined();
    expect(
      suggestCardSplit([
        { top: 10, bottom: 30 },
        { top: 70, bottom: 90 },
      ]),
    ).toBeUndefined();
    expect(
      suggestCardSplit([
        { top: 10, bottom: 30 },
        { top: 50, bottom: 70 },
        { top: 90, bottom: 110 },
      ]),
    ).toBeUndefined();
    expect(
      suggestCardSplit([
        { top: 10, bottom: 30 },
        { top: 70, bottom: 90 },
        { top: 130, bottom: 150 },
      ]),
    ).toBeUndefined();
    expect(
      suggestCardSplit([
        { top: 10, bottom: 30 },
        { top: 70, bottom: 90 },
        { top: 130, bottom: 150 },
        { top: 160, bottom: 180 },
      ]),
    ).toBeUndefined();
    expect(
      suggestCardSplit([
        { top: 10, bottom: 30 },
        { top: 40, bottom: 42 },
        { top: 70, bottom: 90 },
        { top: 110, bottom: 130 },
      ]),
    ).toBeUndefined();
  });
});
