import type { ImageRect, PixelImage } from './image-layout';

/** Keep faint calendar text, remove the pale background and retain source coordinates. */
export function enhanceAxisPixels(image: PixelImage): Uint8ClampedArray {
  const histogram = new Uint32Array(256);
  const luminance = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < luminance.length; pixel++) {
    const offset = pixel * 4;
    const value = Math.round(
      image.data[offset] * 0.2126 +
        image.data[offset + 1] * 0.7152 +
        image.data[offset + 2] * 0.0722,
    );
    luminance[pixel] = value;
    histogram[value]++;
  }
  let count = 0;
  let background = 255;
  for (let value = 0; value < histogram.length; value++) {
    count += histogram[value];
    if (count >= luminance.length * 0.9) {
      background = value;
      break;
    }
  }
  const result = new Uint8ClampedArray(image.data.length);
  // A small contrast margin accommodates JPEG edges without promoting background noise.
  const cutoff = Math.max(0, background - 18);
  for (let pixel = 0; pixel < luminance.length; pixel++) {
    const value = luminance[pixel] < cutoff ? 0 : 255;
    result.set([value, value, value, 255], pixel * 4);
  }
  return result;
}

function textBands(image: PixelImage, startY: number) {
  const bands: { top: number; bottom: number; left: number; right: number }[] = [];
  for (let y = Math.max(0, Math.floor(startY)); y < image.height; y++) {
    let left = image.width;
    let right = -1;
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset] >= 128) continue;
      left = Math.min(left, x);
      right = x;
    }
    if (right - left < 1) continue;
    const previous = bands.at(-1);
    if (previous && y - previous.bottom <= Math.max(2, Math.min(4, image.width * 0.025))) {
      previous.bottom = y;
      previous.left = Math.min(previous.left, left);
      previous.right = Math.max(previous.right, right);
    } else bands.push({ top: y, bottom: y, left, right });
  }
  return bands;
}

function paddedRegion(image: PixelImage, band: ReturnType<typeof textBands>[number]): ImageRect {
  const padding = Math.max(3, Math.ceil(Math.min(image.width, image.height) * 0.035));
  const x = Math.max(0, band.left - padding);
  const y = Math.max(0, band.top - padding);
  return {
    x,
    y,
    width: Math.min(image.width - x, band.right - x + padding + 1),
    height: Math.min(image.height - y, band.bottom - y + padding + 1),
  };
}

/** Isolate wide header rows, preventing toolbar/date text from disturbing the weekday line. */
export function headerTextRegions(image: PixelImage): ImageRect[] {
  return textBands(image, 0)
    .filter((band) => band.right - band.left >= image.width * 0.3 && band.bottom - band.top >= 4)
    .slice(0, 6)
    .map((band) => paddedRegion(image, band));
}

/** Find narrow, isolated sidebar labels; broad clock lines are excluded before OCR. */
export function sidebarPeriodRegions(image: PixelImage, firstCardY: number): ImageRect[] {
  return textBands(image, firstCardY)
    .filter((band) => {
      const width = band.right - band.left + 1;
      const height = band.bottom - band.top + 1;
      return (
        height >= Math.max(5, image.width * 0.08) &&
        width <= image.width * 0.65 &&
        width <= height * 2
      );
    })
    .slice(0, 12)
    .map((band) => paddedRegion(image, band));
}
