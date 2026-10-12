import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDraft } from '../src/features/timetable-import/model';
const state = vi.hoisted(() => ({
  canvases: [] as { width: number; height: number; label: string }[],
  scan: vi.fn(),
  close: vi.fn(),
  finish: vi.fn(),
  readCard: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('../src/features/timetable-import/ocr', () => ({
  createOcr: async () => ({
    scan: state.scan,
    close: state.close,
    finishImageAnalysis: state.finish,
  }),
  imageCanvas: async (file: File) => {
    expect(state.canvases.filter((c) => c.width && c.height)).toHaveLength(0);
    const canvas = {
      width: 200,
      height: 200,
      label: file.name,
      getContext: () => ({ getImageData: () => ({ label: file.name }) }),
    };
    state.canvases.push(canvas);
    return canvas;
  },
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
      'fictional failed',
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
