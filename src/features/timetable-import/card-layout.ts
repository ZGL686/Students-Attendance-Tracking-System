import type { ImageRect, PixelImage } from './image-layout';

/** Top and bottom are inclusive source-image pixel coordinates. */
export type CardTextBand = { top: number; bottom: number };

/** Locate white lettering in a colored card without altering pixels used by OCR. */
export function detectCardTextBands(image: PixelImage, region: ImageRect): CardTextBand[] {
  const inset = Math.max(2, region.width * 0.05);
  const left = Math.max(0, Math.ceil(region.x + inset));
  const right = Math.min(image.width, Math.floor(region.x + region.width - inset));
  const top = Math.max(0, Math.ceil(region.y + inset));
  const bottom = Math.min(image.height, Math.floor(region.y + region.height - inset));
  if (left >= right || top >= bottom) return [];
  const minimumPixels = Math.max(2, region.width * 0.015);
  const mergeGap = region.width * 0.075;
  const bands: CardTextBand[] = [];
  for (let y = top; y < bottom; y++) {
    let white = 0;
    for (let x = left; x < right; x++) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      if (
        Math.min(red, green, blue) > 215 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) < 35
      )
        white++;
    }
    if (white < minimumPixels) continue;
    const previous = bands.at(-1);
    if (previous && y - previous.bottom < mergeGap) previous.bottom = y;
    else bands.push({ top: y, bottom: y });
  }
  return bands;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Suggest a field boundary only when intact lines have a clearly larger separating gap. */
export function suggestCardSplit(bands: CardTextBand[]): number | undefined {
  if (bands.length < 3) return;
  const heights = bands.map((band) => band.bottom - band.top + 1);
  const typicalHeight = median(heights);
  if (heights.some((height) => height <= 0 || height < typicalHeight * 0.5)) return;
  const gaps = bands.slice(1).map((band, index) => band.top - bands[index].bottom);
  if (gaps.some((gap) => gap <= 0)) return;
  const largest = Math.max(...gaps);
  const split = gaps.indexOf(largest);
  const typicalGap = median(gaps);
  if (largest < typicalGap * 1.35) return;
  return (bands[split].bottom + bands[split + 1].top) / 2;
}
