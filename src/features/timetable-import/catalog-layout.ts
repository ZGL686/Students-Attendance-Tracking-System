import type { ImageRect, PixelImage } from './image-layout';
import type { PositionedText } from './parse';

export type CatalogRowRegions = {
  name: ImageRect;
  teacher?: ImageRect;
  code?: ImageRect;
};

type TextRow = { items: PositionedText[]; center: number; height: number };
type Heading = { left: number; right: number; center: number };
type CatalogHeading = {
  row: TextRow;
  name: Heading;
  teacher?: Heading;
  code?: Heading;
};
type Column = { left: number; right: number };

const midpoint = (item: PositionedText) => item.y + item.height / 2;
const normalized = (text: string) => text.replace(/\s/g, '');

function textRows(tokens: PositionedText[]): TextRow[] {
  const rows: TextRow[] = [];
  const sorted = tokens
    .filter((item) => normalized(item.text) && item.width > 0 && item.height > 0)
    .sort((a, b) => midpoint(a) - midpoint(b) || a.x - b.x);
  for (const item of sorted) {
    const center = midpoint(item);
    const row = rows.find(
      (candidate) =>
        Math.abs(center - candidate.center) <= Math.max(item.height, candidate.height) * 0.6,
    );
    if (row) {
      row.items.push(item);
      row.center = row.items.reduce((sum, token) => sum + midpoint(token), 0) / row.items.length;
      row.height = Math.max(row.height, item.height);
    } else rows.push({ items: [item], center, height: item.height });
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => a.center - b.center);
}

/** Character positions also support a single OCR word containing adjacent headings. */
function headingIn(row: TextRow, pattern: RegExp): Heading | undefined {
  const chars = row.items.flatMap((item) => {
    const text = normalized(item.text);
    return Array.from(text, (char, index) => ({
      char,
      left: item.x + (index * item.width) / text.length,
      right: item.x + ((index + 1) * item.width) / text.length,
    }));
  });
  const match = chars
    .map((char) => char.char)
    .join('')
    .match(pattern);
  if (match?.index === undefined) return;
  const left = chars[match.index].left;
  const right = chars[match.index + match[0].length - 1].right;
  return { left, right, center: (left + right) / 2 };
}

function catalogHeading(rows: TextRow[]): CatalogHeading | undefined {
  for (const row of rows) {
    const name = headingIn(row, /课程名称|课程名/);
    const teacher = headingIn(row, /任课教师|授课教师|教师|老师/);
    const code = headingIn(row, /课程代码|课程编号|课程编码/);
    const text = row.items.map((item) => normalized(item.text)).join('');
    if (name && (teacher || code) && !/星期|周次|节次/.test(text))
      return { row, name, teacher, code };
  }
}

function brightness(image: PixelImage, x: number, y: number): number {
  const offset = (y * image.width + x) * 4;
  return (
    image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722
  );
}

/** Long faint grid strokes survive this projection, while disconnected letters do not. */
function gridLines(image: PixelImage, vertical: boolean): number[] {
  const length = vertical ? image.width : image.height;
  const cross = vertical ? image.height : image.width;
  const radius = Math.max(2, Math.round(Math.min(image.width, image.height) * 0.005));
  const step = Math.max(1, Math.floor(cross / 1000));
  const scores: number[] = [];
  for (let position = radius; position < length - radius; position++) {
    let marked = 0;
    let samples = 0;
    for (let coordinate = 0; coordinate < cross; coordinate += step) {
      const read = (offset: number) =>
        brightness(
          image,
          vertical ? position + offset : coordinate,
          vertical ? coordinate : position + offset,
        );
      if ((read(-radius) + read(radius)) / 2 - read(0) >= 3) marked++;
      samples++;
    }
    scores[position] = marked / samples;
  }
  const groups: number[][] = [];
  for (let position = radius; position < length - radius; position++) {
    if (scores[position] < 0.65) continue;
    const previous = groups.at(-1);
    if (previous && position - previous.at(-1)! <= radius * 2) previous.push(position);
    else groups.push([position]);
  }
  return groups.map((group) => {
    const weight = group.reduce((sum, position) => sum + scores[position], 0);
    return Math.round(
      group.reduce((sum, position) => sum + position * scores[position], 0) / weight,
    );
  });
}

function enclosingColumn(heading: Heading | undefined, lines: number[]): Column | undefined {
  if (!heading) return;
  const rightIndex = lines.findIndex((line) => line > heading.center);
  if (rightIndex < 1) return;
  const left = lines[rightIndex - 1];
  const right = lines[rightIndex];
  if (right - left < heading.right - heading.left || heading.left < left - 2) return;
  return { left, right };
}

function rowBoundsFromText(
  rows: TextRow[],
  heading: CatalogHeading,
  name: Column,
  code: Column | undefined,
  imageHeight: number,
): [number, number][] {
  const centers = rows
    .filter((row) => row.center > heading.row.center + heading.row.height)
    .filter((row) => {
      const names = row.items.filter(
        (item) => item.x + item.width / 2 > name.left && item.x + item.width / 2 < name.right,
      );
      const codes = code
        ? row.items
            .filter(
              (item) => item.x + item.width / 2 > code.left && item.x + item.width / 2 < code.right,
            )
            .map((item) => normalized(item.text))
            .join('')
        : '';
      return names.length > 0 && (!code || /[A-Za-z]*\d{4,}/.test(codes));
    })
    .map((row) => row.center);
  if (!centers.length) return [];
  const gaps = centers.slice(1).map((center, index) => center - centers[index]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? heading.row.height * 2;
  return centers.map((center, index) => [
    index ? (centers[index - 1] + center) / 2 : center - typical / 2,
    Math.min(
      imageHeight,
      index < centers.length - 1 ? (center + centers[index + 1]) / 2 : center + typical / 2,
    ),
  ]);
}

function cell(column: Column, top: number, bottom: number, image: PixelImage): ImageRect {
  const inset = Math.max(1, Math.round((bottom - top) * 0.04));
  const x = Math.max(0, Math.round(column.left + inset));
  const y = Math.max(0, Math.round(top + inset));
  return {
    x,
    y,
    width: Math.max(1, Math.min(image.width, Math.round(column.right - inset)) - x),
    height: Math.max(1, Math.min(image.height, Math.round(bottom - inset)) - y),
  };
}

/** Return only cell geometry; OCR contents and catalog lifetimes belong to the import reader. */
export function detectCatalogRows(
  image: PixelImage,
  tokens: PositionedText[],
): CatalogRowRegions[] {
  if (image.width < 20 || image.height < 20) return [];
  const rows = textRows(tokens);
  const heading = catalogHeading(rows);
  if (!heading) return [];
  const vertical = [0, ...gridLines(image, true), image.width];
  const name = enclosingColumn(heading.name, vertical);
  const teacher = enclosingColumn(heading.teacher, vertical);
  const code = enclosingColumn(heading.code, vertical);
  // A course-name heading alone cannot safely determine where its cell begins or ends.
  if (!name || vertical.length < 4 || (!teacher && !code)) return [];
  const horizontal = gridLines(image, false).filter(
    (line) => line > heading.row.center + heading.row.height * 0.4,
  );
  const intervals = horizontal.slice(1).map((bottom, index) => [horizontal[index], bottom]);
  const heights = intervals
    .map(([top, bottom]) => bottom - top)
    .filter((height) => height >= Math.max(8, heading.row.height * 0.7))
    .sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)];
  const gridBounds = typical
    ? intervals.filter(
        ([top, bottom]) => bottom - top >= typical * 0.6 && bottom - top <= typical * 1.7,
      )
    : [];
  const textBounds = rowBoundsFromText(rows, heading, name, code, image.height);
  const bounds = textBounds.length > gridBounds.length ? textBounds : gridBounds;
  return bounds.map(([top, bottom]) => ({
    name: cell(name, top, bottom, image),
    ...(teacher ? { teacher: cell(teacher, top, bottom, image) } : {}),
    ...(code ? { code: cell(code, top, bottom, image) } : {}),
  }));
}
