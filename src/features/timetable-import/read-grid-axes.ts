import { enhanceAxisPixels, headerTextRegions, sidebarPeriodRegions } from './axis-image';
import { locateGridAxes } from './image-layout';
import type { GridAxes, ImageRect } from './image-layout';
import type { OcrText } from './ocr';
import type { OcrEngine } from './ocr-regions';

/** Preserve the clear-image path; only missing axes need contrast and digit-specific retries. */
export async function readGridAxes(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
  regions: ImageRect[],
  retryTokens?: OcrText['tokens'],
): Promise<{ axes: GridAxes | null; scan: OcrText }> {
  const sidebarWidth = Math.max(
    1,
    Math.floor(Math.min(...regions.map((region) => region.x)) * 0.95),
  );
  const headerHeight = Math.max(1, Math.floor(Math.min(...regions.map((region) => region.y))));
  const header = { x: 0, y: 0, width: canvas.width, height: headerHeight };
  const sidebar = { x: 0, y: 0, width: sidebarWidth, height: canvas.height };
  const tokens: OcrText['tokens'] = [...(retryTokens ?? [])];
  const result = (axes: GridAxes | null) => ({
    axes,
    scan: { text: tokens.map((token) => token.text).join(' '), tokens, confidence: 0 },
  });
  if (!retryTokens) {
    for (const scale of [1, 2, 3]) {
      tokens.push(...(await engine.scan(canvas, header, scale, 'sparse')).tokens);
      tokens.push(...(await engine.scan(canvas, sidebar, scale, 'sparse')).tokens);
      const axes = locateGridAxes(tokens, regions, canvas.width, canvas.height);
      if (axes) return result(axes);
    }
    // A mixed-language whole-image scan can still recover axes before regional retries.
    return result(null);
  }
  const enhanced = document.createElement('canvas');
  try {
    const source = canvas.getContext('2d', { willReadFrequently: true });
    if (!source) throw new Error('无法创建星期与节次识别画布。');
    for (const region of [header, sidebar]) {
      // Keep only one small axis crop alive, avoiding a second full-size mobile image.
      enhanced.width = region.width;
      enhanced.height = region.height;
      const context = enhanced.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法创建星期与节次识别画布。');
      const pixels = source.getImageData(region.x, region.y, region.width, region.height);
      pixels.data.set(enhanceAxisPixels(pixels));
      context.putImageData(pixels, 0, 0);
      tokens.push(...(await engine.scan(enhanced, region, 2, 'sparse')).tokens);
      const axes = locateGridAxes(tokens, regions, canvas.width, canvas.height);
      if (axes) return result(axes);
      const rows =
        region === header ? headerTextRegions(pixels) : sidebarPeriodRegions(pixels, headerHeight);
      for (const row of rows) {
        const scan = await engine.scan(enhanced, row, 2, region === header ? 'line' : 'digits');
        // English SINGLE_LINE and a numeric whitelist avoid treating clocks as Chinese words.
        if (region === sidebar && !/^(?:[1-9]|10)$/.test(scan.text.trim())) continue;
        tokens.push(...scan.tokens);
      }
      const retried = locateGridAxes(tokens, regions, canvas.width, canvas.height);
      if (retried) return result(retried);
    }
    return result(locateGridAxes(tokens, regions, canvas.width, canvas.height));
  } finally {
    enhanced.width = 0;
    enhanced.height = 0;
  }
}
