import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '../src/features/timetable-import/model';
const state = vi.hoisted(() => ({
  canvases: [] as { width: number; height: number; label: string }[],
  scan: vi.fn(),
  close: vi.fn(),
  finish: vi.fn(),
  readCard: vi.fn(),
  retry: vi.fn(),
  decode: vi.fn(),
}));
vi.mock('../src/features/timetable-import/ocr', () => ({
  createOcr: async () => ({
    scan: state.scan,
    close: state.close,
    finishImageAnalysis: state.finish,
  }),
  imageCanvas: state.decode,
}));
vi.mock('../src/features/timetable-import/image-layout', () => ({
  detectColoredRegions: (pixels: { label: string }) =>
    pixels.label.includes('catalog') ? [] : [{ x: 20, y: 20, width: 100, height: 100 }],
  locateGridAxes: () => ({
    days: [{ day: 1, x: 50 }],
    periods: [
      { period: 1, y: 40 },
      { period: 2, y: 80 },
    ],
  }),
  regionPlacement: () => ({ day: 1, start: 1, end: 2 }),
}));
vi.mock('../src/features/timetable-import/catalog-layout', () => ({
  detectCatalogRows: (pixels: { label: string }) =>
    pixels.label.includes('catalog') ? [{ name: { x: 0, y: 0, width: 100, height: 100 } }] : [],
}));
vi.mock('../src/features/timetable-import/catalog-field', () => ({
  cachedCatalogField: () => undefined,
}));
vi.mock('../src/features/timetable-import/ocr-regions', () => ({ retryRegion: state.retry }));
vi.mock('../src/features/timetable-import/readCard', () => ({ readCard: state.readCard }));
import { readImages } from '../src/features/timetable-import/readImages';
const file = (name: string) => new File(['fictional'], name);
beforeEach(() => {
  vi.resetAllMocks();
  state.canvases.length = 0;
  state.decode.mockImplementation(async (file: File) => {
    expect(state.canvases.filter((c) => c.width && c.height)).toHaveLength(0);
    const canvas = {
      width: 200,
      height: 200,
      label: file.name,
      getContext: () => ({ getImageData: () => ({ label: file.name }) }),
    };
    state.canvases.push(canvas);
    return canvas;
  });
  state.scan.mockResolvedValue({ text: '虚构目录课程', tokens: [], confidence: 95 });
  state.retry.mockResolvedValue([{ text: '虚构目录课程', tokens: [], confidence: 95 }]);
  state.finish.mockResolvedValue(undefined);
  state.close.mockResolvedValue(undefined);
  state.readCard.mockImplementation(
    async (_engine, _canvas, _region, source, _placement, references) => {
      expect(references).toHaveLength(1);
      return { ...createEmptyDraft(source), name: '虚构排课', day: '1', start: '1', end: '2' };
    },
  );
});
const expectReleased = () => {
  expect(state.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  expect(state.close).toHaveBeenCalledTimes(1);
};
describe('bounded multi-image canvases', () => {
  it('reads every image while retaining at most one source canvas and catalogs before cards', async () => {
    const result = await readImages(
      [file('card1.png'), file('catalog1.png'), file('card2.png'), file('catalog2.png')],
      {},
    );
    expect(result.drafts).toHaveLength(2);
    expect(result.catalog).toHaveLength(1);
    expect(state.canvases).toHaveLength(8);
    expect(state.finish).toHaveBeenCalledTimes(1);
    expect(state.finish.mock.invocationCallOrder[0]).toBeLessThan(
      state.retry.mock.invocationCallOrder[0],
    );
    expect(state.retry.mock.invocationCallOrder.at(-1)).toBeLessThan(
      state.readCard.mock.invocationCallOrder[0],
    );
    expectReleased();
  });
  it('releases the current decoded image and closes the engine when card recognition fails', async () => {
    state.readCard.mockRejectedValueOnce(new Error('fictional failed'));
    await expect(readImages([file('catalog.png'), file('card.png')], {})).rejects.toThrow(
      '图片“card.png” · 识别课程格 1/1失败：fictional failed',
    );
    expectReleased();
  });
  it('announces the decode stage before awaiting it and keeps batch progress monotonic', async () => {
    const progress = vi.fn();
    await readImages([file('catalog.png'), file('card.png')], { onProgress: progress });
    const reports = progress.mock.calls.map(([value]) => value);
    expect(reports[1].stage).toBe('正在解码图片 1/2（catalog.png）…');
    expect(progress.mock.invocationCallOrder[1]).toBeLessThan(
      state.decode.mock.invocationCallOrder[0],
    );
    expect(reports.some((value) => value.stage === '正在解码课程目录（catalog.png）…')).toBe(true);
    expect(reports.some((value) => value.stage === '正在解码课表（card.png）…')).toBe(true);
    const values = reports.map((value) => value.progress);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expectReleased();
  });
  it('preserves the filename and decode error without adding a second prefix', async () => {
    const error = new Error('图片“catalog.png” · 解码失败：fictional decoder failed');
    state.decode.mockRejectedValueOnce(error);
    await expect(readImages([file('catalog.png')], {})).rejects.toBe(error);
    expect(state.canvases).toHaveLength(0);
    expectReleased();
  });
  it('identifies the source file and whole-image scan phase when analysis fails', async () => {
    state.scan.mockRejectedValueOnce(new Error('fictional scan failed'));
    await expect(readImages([file('catalog.png')], {})).rejects.toThrow(
      '图片“catalog.png” · 读取整图文字失败：fictional scan failed',
    );
    expectReleased();
  });
  it('identifies the source file and directory row when a regional scan fails', async () => {
    state.retry.mockRejectedValueOnce(new Error('fictional region failed'));
    await expect(readImages([file('catalog.png')], {})).rejects.toThrow(
      '图片“catalog.png” · 读取课程目录第 1 行失败：fictional region failed',
    );
    expectReleased();
  });
  it('releases a prepared image when cancellation rejects its scan', async () => {
    const controller = new AbortController();
    state.scan.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('取消', 'AbortError');
    });
    await expect(
      readImages([file('catalog.png'), file('card.png')], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.canvases).toHaveLength(1);
    expectReleased();
  });
});
