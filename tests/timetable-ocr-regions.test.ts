import { expect, it } from 'vitest';
import { invertCardLuminance } from '../src/features/timetable-import/ocr-regions';

it('preserves soft antialiasing when reversing colored card luminance', () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255, 220, 220, 220, 255, 120, 120, 120, 255, 20, 80, 220, 255,
  ]);
  invertCardLuminance(pixels);
  expect([...pixels.slice(0, 12)]).toEqual([0, 0, 0, 255, 35, 35, 35, 255, 135, 135, 135, 255]);
  expect(pixels[12]).toBe(pixels[13]);
  expect(pixels[13]).toBe(pixels[14]);
  expect(pixels[15]).toBe(255);
});
