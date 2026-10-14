import { describe, expect, it } from 'vitest';
import {
  enhanceAxisPixels,
  sidebarPeriodRegions,
} from '../src/features/timetable-import/axis-image';
import type { PixelImage } from '../src/features/timetable-import/image-layout';

function image(width: number, height: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([220, 227, 240, 255], offset);
  return { width, height, data };
}
function rectangle(
  target: PixelImage,
  x: number,
  y: number,
  width: number,
  height: number,
  value = 160,
) {
  for (let row = y; row < y + height; row++)
    for (let column = x; column < x + width; column++)
      target.data.set([value, value, value, 255], (row * target.width + column) * 4);
}

describe('missing timetable axis retries', () => {
  it('enhances faint axis lettering and removes small pale JPEG noise without changing dimensions', () => {
    const target = image(100, 100);
    rectangle(target, 35, 20, 20, 25);
    rectangle(target, 15, 45, 40, 20, 220);
    const enhanced = enhanceAxisPixels(target);
    expect(enhanced).toHaveLength(target.data.length);
    expect([...enhanced.slice((30 * 100 + 40) * 4, (30 * 100 + 40) * 4 + 4)]).toEqual([
      0, 0, 0, 255,
    ]);
    expect([...enhanced.slice((50 * 100 + 20) * 4, (50 * 100 + 20) * 4 + 4)]).toEqual([
      255, 255, 255, 255,
    ]);
    expect(target.data[(30 * 100 + 40) * 4]).toBe(160);
  });

  it('keeps the period glyphs and rejects broad clock lines and the calendar month above the courses', () => {
    const target = image(90, 600);
    rectangle(target, 30, 30, 32, 25); // month
    for (const y of [130, 250, 370, 490]) {
      rectangle(target, 35, y, 20, 25);
      rectangle(target, 10, y + 35, 70, 20); // clock
      rectangle(target, 10, y + 60, 70, 20);
    }
    const enhanced = { ...target, data: enhanceAxisPixels(target) };
    const regions = sidebarPeriodRegions(enhanced, 100);
    expect(regions).toHaveLength(4);
    expect(regions.map((region) => region.y)).toEqual([126, 246, 366, 486]);
    expect(regions.every((region) => region.width === 28 && region.height === 33)).toBe(true);
  });

  it('bounds retries when the sidebar contains too many small items', () => {
    const target = image(100, 1000);
    for (let y = 20; y < 950; y += 40) rectangle(target, 40, y, 15, 18);
    expect(sidebarPeriodRegions({ ...target, data: enhanceAxisPixels(target) }, 0)).toHaveLength(
      12,
    );
  });
});
