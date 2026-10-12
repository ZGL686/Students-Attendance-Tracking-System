import type { ImageRect } from './image-layout';
import type { createOcr, OcrText } from './ocr';

export type OcrEngine = Awaited<ReturnType<typeof createOcr>>;

/** Preserve antialiasing while presenting white card lettering as dark glyphs. */
export function invertCardLuminance(pixels: Uint8ClampedArray): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const value =
      255 - (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722);
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
  }
}

export async function contrastRegion(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  region: ImageRect,
  force = false,
): Promise<OcrText[]> {
  const crop = document.createElement('canvas');
  try {
    crop.width = region.width;
    crop.height = region.height;
    const context = crop.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法创建局部识别画布。');
    context.drawImage(
      canvas,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    const pixels = context.getImageData(0, 0, crop.width, crop.height);
    invertCardLuminance(pixels.data);
    context.putImageData(pixels, 0, 0);
    const results = await retryRegion(
      engine,
      crop,
      {
        x: 0,
        y: 0,
        width: crop.width,
        height: crop.height,
      },
      false,
      force,
    );
    return results.map((result) => ({
      ...result,
      tokens: result.tokens.map((token) => ({
        ...token,
        x: token.x + region.x,
        y: token.y + region.y,
      })),
    }));
  } finally {
    crop.width = 0;
    crop.height = 0;
  }
}

export async function retryRegion(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  region: ImageRect,
  line = false,
  force = false,
): Promise<OcrText[]> {
  const first = await engine.scan(canvas, region, 1, line ? 'line' : 'block');
  const results = [first];
  if (force || first.confidence < 90 || !first.text.trim()) {
    results.push(await engine.scan(canvas, region, 2, line ? 'line' : 'block'));
    results.push(await engine.scan(canvas, region, 3, line ? 'line' : 'block'));
  }
  return results;
}
