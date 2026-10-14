import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGridAxes } from '../src/features/timetable-import/read-grid-axes';
import { regionPlacement } from '../src/features/timetable-import/image-layout';
import type { ImageRect, PixelImage } from '../src/features/timetable-import/image-layout';
import type { OcrMode, OcrText } from '../src/features/timetable-import/ocr';
import type { OcrEngine } from '../src/features/timetable-import/ocr-regions';

class FakeCanvas {
  width = 0;
  height = 0;
  data: Uint8ClampedArray = new Uint8ClampedArray();
  getContext() {
    return {
      getImageData: (x: number, y: number, width: number, height: number): PixelImage => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++)
          for (let column = 0; column < width; column++) {
            const source = ((row + y) * this.width + column + x) * 4;
            data.set(this.data.slice(source, source + 4), (row * width + column) * 4);
          }
        return { width, height, data };
      },
      putImageData: (image: PixelImage) => {
        this.data = image.data;
      },
    };
  }
}

const rects: ImageRect[] = [
  { x: 151, y: 195, width: 78, height: 208 },
  { x: 61, y: 415, width: 78, height: 208 },
];
const empty = (): OcrText => ({ text: '', tokens: [], confidence: 0 });
const heading: OcrText = {
  text: '一 二 三 四 五 六 日',
  confidence: 95,
  tokens: [{ text: '一 二 三 四 五 六 日', x: 89, y: 89, width: 562, height: 22, confidence: 95 }],
};
const periods = Array.from({ length: 7 }, (_, index) => ({
  text: String(index + 1),
  x: 30,
  y: 218 + index * 110,
  width: 18,
  height: 24,
  confidence: 96,
}));
const engine = (scan: OcrEngine['scan']): OcrEngine => ({
  scan,
  close: async () => {},
  recognize: async () => [],
});

function source() {
  const canvas = new FakeCanvas();
  canvas.width = 800;
  canvas.height = 1200;
  canvas.data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  for (let offset = 0; offset < canvas.data.length; offset += 4)
    canvas.data.set([230, 230, 230, 255], offset);
  for (const region of [{ x: 89, y: 89, width: 562, height: 22 }, ...periods])
    for (let y = region.y; y < region.y + region.height; y++)
      for (let x = region.x; x < region.x + region.width; x++)
        canvas.data.set([160, 160, 160, 255], (y * canvas.width + x) * 4);
  return canvas as unknown as HTMLCanvasElement;
}

describe('timetable axes retry orchestration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps clear axes on the original two-scan path and allocates no enhancement canvas', async () => {
    const scan = vi
      .fn<OcrEngine['scan']>()
      .mockResolvedValueOnce(heading)
      .mockResolvedValueOnce({ text: '1 2 3 4 5 6 7', tokens: periods, confidence: 96 });
    const result = await readGridAxes(engine(scan), source(), rects);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(result.axes?.days[0]).toEqual({ day: 1, x: 100 });
  });

  it('defers enhancement until the existing whole-image fallback has also failed', async () => {
    const scan = vi.fn<OcrEngine['scan']>().mockImplementation(async () => empty());
    const result = await readGridAxes(engine(scan), source(), rects);
    expect(scan).toHaveBeenCalledTimes(6);
    expect(result.axes).toBeNull();
  });

  it('really executes contrast and English digit retries, preserves placements and releases the small crop', async () => {
    const crop = new FakeCanvas();
    vi.stubGlobal('document', { createElement: () => crop });
    const sizes: { width: number; height: number; mode?: OcrMode }[] = [];
    const scan = vi
      .fn<OcrEngine['scan']>()
      .mockImplementation(async (canvas, region, _scale, mode) => {
        sizes.push({ width: canvas.width, height: canvas.height, mode });
        if (mode === 'line') return heading;
        if (mode !== 'digits') return empty();
        const token = periods.find(
          (token) => token.y >= region!.y && token.y < region!.y + region!.height,
        )!;
        return { text: token.text, tokens: [token], confidence: 96 };
      });
    const result = await readGridAxes(engine(scan), source(), rects, []);
    expect(scan.mock.calls.filter((call) => call[3] === 'digits')).toHaveLength(7);
    expect(sizes.find((size) => size.mode === 'line')).toMatchObject({ width: 800, height: 195 });
    expect(sizes.find((size) => size.mode === 'digits')).toMatchObject({ width: 57, height: 1200 });
    expect(rects.map((rect) => regionPlacement(rect, result.axes!))).toEqual([
      { day: 2, start: 1, end: 2 },
      { day: 1, start: 3, end: 4 },
    ]);
    expect(crop.width).toBe(0);
    expect(crop.height).toBe(0);
  });

  it('propagates cancellation and still releases the enhanced canvas', async () => {
    const crop = new FakeCanvas();
    vi.stubGlobal('document', { createElement: () => crop });
    const aborted = new DOMException('已取消导入。', 'AbortError');
    const scan = vi.fn<OcrEngine['scan']>().mockRejectedValue(aborted);
    await expect(readGridAxes(engine(scan), source(), rects, [])).rejects.toBe(aborted);
    expect(crop.width).toBe(0);
    expect(crop.height).toBe(0);
  });

  it('retains the three-anchor requirement after enhanced scans', async () => {
    const crop = new FakeCanvas();
    vi.stubGlobal('document', { createElement: () => crop });
    const scan = vi
      .fn<OcrEngine['scan']>()
      .mockImplementation(async (_canvas, _region, _scale, mode) => {
        if (mode === 'line')
          return { ...heading, text: '周一', tokens: [{ ...heading.tokens[0], text: '周一' }] };
        return empty();
      });
    expect((await readGridAxes(engine(scan), source(), rects, [])).axes).toBeNull();
    expect(crop.width).toBe(0);
  });
});
