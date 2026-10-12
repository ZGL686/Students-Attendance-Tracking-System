import { describe, expect, it } from 'vitest';
import { detectCatalogRows } from '../src/features/timetable-import/catalog-layout';
import type { PixelImage } from '../src/features/timetable-import/image-layout';
import type { PositionedText } from '../src/features/timetable-import/parse';

function fixture(scale = 1, horizontalLines = true) {
  const width = Math.round(1000 * scale);
  const height = Math.round(720 * scale);
  const image: PixelImage = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  image.data.fill(255);
  const paint = (x: number, y: number, w: number, h: number, shade: number) => {
    for (let row = Math.round(y * scale); row < Math.round((y + h) * scale); row++) {
      for (let column = Math.round(x * scale); column < Math.round((x + w) * scale); column++) {
        const offset = (row * width + column) * 4;
        image.data[offset] = shade;
        image.data[offset + 1] = shade + 5;
        image.data[offset + 2] = shade + 10;
      }
    }
  };
  for (const x of [0, 280, 390, 640, 770, 870, 998]) paint(x, 0, 2, 700, 220);
  if (horizontalLines) for (let y = 50; y <= 700; y += 50) paint(0, y, 1000, 2, 220);
  const token = (text: string, x: number, y: number, w: number): PositionedText => ({
    text,
    x: x * scale,
    y: y * scale,
    width: w * scale,
    height: 18 * scale,
    confidence: 98,
  });
  const tokens = [
    token('开课单位', 80, 15, 85),
    token('课程代码', 296, 15, 80),
    token('课程', 466, 15, 40),
    token('名称', 506, 15, 40),
    token('任课教师课程性质', 660, 15, 190),
  ];
  for (let index = 0; index < 13; index++) {
    const y = 65 + index * 50;
    tokens.push(
      token(`F${String(1000 + index)}`, 300, y, 70),
      token(`虚构设计课程${index + 1}`, 405, y, 210),
      token('虚构教师', 665, y, 80),
    );
    paint(405, y, 100, 18, 10);
    paint(665, y, 80, 18, 10);
  }
  return { image, tokens };
}

describe('catalog cell geometry', () => {
  it('locates all 13 rows using real cell boundaries rather than header midpoints', () => {
    const { image, tokens } = fixture();
    const rows = detectCatalogRows(image, tokens);
    expect(rows).toHaveLength(13);
    expect(rows[0].name).toEqual({ x: 393, y: 53, width: 246, height: 45 });
    expect(rows[0].teacher).toEqual({ x: 643, y: 53, width: 126, height: 45 });
    expect(rows[0].code).toEqual({ x: 283, y: 53, width: 106, height: 45 });
    expect(rows[12].name.y).toBe(653);
  });

  it.each([0.5, 2])('keeps original-image cell coordinates at scale %s', (scale) => {
    const { image, tokens } = fixture(scale);
    const rows = detectCatalogRows(image, tokens);
    expect(rows).toHaveLength(13);
    expect(rows[0].name.x / scale).toBeCloseTo(393, -1);
    expect(rows[0].name.y / scale).toBeCloseTo(53, -1);
    expect(rows[12].name.y / scale).toBeCloseTo(653, -1);
    expect(rows.every((row) => row.name.width / scale >= 240)).toBe(true);
  });

  it('recovers rows from aligned course codes when horizontal grid strokes are absent', () => {
    const { image, tokens } = fixture(1, false);
    const rows = detectCatalogRows(image, tokens);
    expect(rows).toHaveLength(13);
    expect(rows[0].name.y).toBeLessThan(65);
    expect(rows[0].name.y + rows[0].name.height).toBeGreaterThan(83);
  });

  it('does not mistake aligned text strokes for a horizontal cell boundary', () => {
    const { image, tokens } = fixture();
    for (let x = 0; x < 500; x++) {
      for (const y of [65, 66]) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 20;
      }
    }
    const rows = detectCatalogRows(image, tokens);
    expect(rows).toHaveLength(13);
    expect(rows[0].name.y).toBe(53);
    expect(rows[0].name.height).toBeGreaterThan(40);
  });

  it('recovers the first catalog row when the header-bottom stroke is damaged', () => {
    const { image, tokens } = fixture();
    for (const y of [50, 51]) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 255;
      }
    }
    const rows = detectCatalogRows(image, tokens);
    expect(rows).toHaveLength(13);
    expect(rows[0].name.y).toBeLessThan(65);
    expect(rows[0].name.y + rows[0].name.height).toBeGreaterThan(83);
  });

  it('rejects timetables and heading-like body text without reliable table columns', () => {
    const { image, tokens } = fixture();
    expect(
      detectCatalogRows(image, [
        ...tokens.slice(0, 5),
        {
          text: '星期',
          x: 900,
          y: 15,
          width: 50,
          height: 18,
        },
      ]),
    ).toEqual([]);
    const plain = { ...image, data: new Uint8ClampedArray(image.data.length).fill(255) };
    expect(detectCatalogRows(plain, tokens)).toEqual([]);
    expect(
      detectCatalogRows(
        image,
        tokens.filter((item) => item.y > 50),
      ),
    ).toEqual([]);
  });
});
