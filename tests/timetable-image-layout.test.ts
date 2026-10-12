import { describe, expect, it } from 'vitest';
import {
  detectColoredRegions,
  locateGridAxes,
  regionPlacement,
} from '../src/features/timetable-import/image-layout';
import type { PixelImage } from '../src/features/timetable-import/image-layout';
import type { PositionedText } from '../src/features/timetable-import/parse';

function image(width = 800, height = 1200): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set([226, 230, 245, 255], offset);
  return { width, height, data };
}

function rectangle(
  target: PixelImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number[],
) {
  for (let row = y; row < y + height; row++)
    for (let column = x; column < x + width; column++)
      target.data.set([...color, 255], (row * target.width + column) * 4);
}

const token = (
  text: string,
  centerX: number,
  centerY: number,
  width = 22,
  height = 22,
): PositionedText => ({
  text,
  x: centerX - width / 2,
  y: centerY - height / 2,
  width,
  height,
});

function labels() {
  const headings = [...'一二三四五六日'].map((day, index) =>
    token(day, 100 + index * 90, 100, 22, day === '一' ? 2 : 22),
  );
  const periods = [1, 4, 5, 8, 9].map((period) =>
    token(String(period), 35, 120 + period * 110, 18, 24),
  );
  return [
    ...headings,
    ...periods,
    ...Array.from({ length: 7 }, (_, index) => token(String(index + 5), 100 + index * 90, 150)),
    token('10', 35, 155),
    token('09', 20, 370),
    token('周五', 260, 24),
    token('三', 100, 600),
  ];
}

const placements = [
  { day: 1, start: 3, end: 4 },
  { day: 1, start: 5, end: 8 },
  { day: 2, start: 1, end: 2 },
  { day: 2, start: 3, end: 4 },
  { day: 2, start: 5, end: 6 },
  { day: 3, start: 1, end: 2 },
  { day: 3, start: 3, end: 4 },
  { day: 4, start: 3, end: 4 },
  { day: 4, start: 5, end: 6 },
  { day: 4, start: 7, end: 8 },
  { day: 5, start: 3, end: 4 },
];

function coloredSchedule() {
  const target = image();
  placements.forEach((placement, index) => {
    const x = 61 + (placement.day - 1) * 90;
    const y = 120 + placement.start * 110 - 35;
    const height = (placement.end - placement.start + 1) * 110 - 12;
    rectangle(target, x, y, 78, height, index % 2 ? [61, 145, 224] : [225, 57, 106]);
    // White lettering and a lighter border must not split one colored course block.
    rectangle(target, x + 18, y + 22, 30, 8, [255, 255, 255]);
    rectangle(target, x + 18, y + 40, 30, 8, [255, 255, 255]);
  });
  rectangle(target, 740, 450, 55, 150, [45, 45, 45]);
  rectangle(target, 12, 55, 12, 12, [20, 130, 240]);
  rectangle(target, 10, 175, 770, 2, [40, 160, 210]);
  return target;
}

describe('colored timetable geometry with fictional layout', () => {
  it('finds whole blocks through white text and excludes pale backgrounds, table lines and controls', () => {
    const regions = detectColoredRegions(coloredSchedule());
    expect(regions).toHaveLength(11);
    expect(regions.find((region) => region.x === 61 && region.y === 635)).toMatchObject({
      width: 78,
      height: 428,
    });
  });

  it('recovers missed period labels and maps each complete block, including a four-period course', () => {
    const target = coloredSchedule();
    const regions = detectColoredRegions(target);
    const axes = locateGridAxes(labels(), regions, target.width, target.height);
    expect(axes).not.toBeNull();
    expect(axes?.periods.map((period) => period.period)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(axes?.periods.find((period) => period.period === 2)?.y).toBe(340);
    expect(regions.map((region) => regionPlacement(region, axes!))).toEqual(
      [...placements].sort((a, b) => a.start - b.start || a.day - b.day),
    );
  });

  it('reconstructs a missed weekday without using calendar dates as weekday headings', () => {
    const target = coloredSchedule();
    const regions = detectColoredRegions(target);
    const withoutMonday = labels().filter((item) => item.text !== '一');
    const axes = locateGridAxes(withoutMonday, regions, target.width, target.height);
    expect(axes?.days[0]).toEqual({ day: 1, x: 100 });
    expect(axes?.days[6]).toEqual({ day: 7, x: 640 });
  });

  it('requires enough consistent axes and refuses a block that spans two weekday columns', () => {
    const target = coloredSchedule();
    const regions = detectColoredRegions(target);
    expect(
      locateGridAxes(
        labels().filter((item) => !/^[一二三四五六日]$/.test(item.text)),
        regions,
        800,
        1200,
      ),
    ).toBeNull();
    expect(
      locateGridAxes(
        labels().filter((item) => !['4', '5', '8', '9'].includes(item.text)),
        regions,
        800,
        1200,
      ),
    ).toBeNull();
    const axes = locateGridAxes(labels(), regions, 800, 1200)!;
    expect(regionPlacement({ x: 60, y: 195, width: 170, height: 210 }, axes)).toBeNull();
    expect(regionPlacement({ x: 61, y: 160, width: 78, height: 30 }, axes)).toBeNull();
  });

  it('preserves coordinates after bounded sampling and tolerates compression color noise', () => {
    const target = image(1800, 3000);
    rectangle(target, 250, 760, 210, 520, [230, 86, 118]);
    for (let y = 760; y < 1280; y++)
      for (let x = 250; x < 460; x++) {
        const offset = (y * target.width + x) * 4;
        target.data[offset + 1] += (x + y) % 9;
        target.data[offset + 2] -= (x * y) % 7;
      }
    const regions = detectColoredRegions(target);
    expect(regions).toHaveLength(1);
    expect(Math.abs(regions[0].x - 250)).toBeLessThanOrEqual(2);
    expect(Math.abs(regions[0].y - 760)).toBeLessThanOrEqual(2);
    expect(Math.abs(regions[0].width - 210)).toBeLessThanOrEqual(3);
    expect(Math.abs(regions[0].height - 520)).toBeLessThanOrEqual(3);
  });
});
