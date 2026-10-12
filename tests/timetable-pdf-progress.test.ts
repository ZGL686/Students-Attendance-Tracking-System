import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readPdf } from '../src/features/timetable-import/readPdf';
import { createEmptyDraft } from '../src/features/timetable-import/model';
import type {
  CourseDraft,
  ImportProgress,
  ReadOptions,
} from '../src/features/timetable-import/model';
import type { PositionedText } from '../src/features/timetable-import/parse';

const mocked = vi.hoisted(() => ({
  getDocument: vi.fn(),
  parse: vi.fn(),
  createOcr: vi.fn(),
  recognize: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: mocked.getDocument,
  Util: { transform: (_viewport: number[], transform: number[]) => transform },
}));
vi.mock('../src/features/timetable-import/parse', () => ({ parsePositionedText: mocked.parse }));
vi.mock('../src/features/timetable-import/ocr', () => ({ createOcr: mocked.createOcr }));

function complete(name: string): CourseDraft {
  return {
    ...createEmptyDraft(name),
    name,
    day: '1',
    start: '1',
    end: '2',
    weeks: '1-16',
  };
}
function page(text = '') {
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 200 * scale,
      height: 100 * scale,
      transform: [1, 0, 0, 1, 0, 0],
    })),
    getTextContent: vi.fn(async () => ({
      items: text ? [{ str: text, transform: [1, 0, 0, 1, 10, 20], height: 10, width: 60 }] : [],
    })),
    render: vi.fn((_options: { canvas: HTMLCanvasElement }) => ({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    })),
    cleanup: vi.fn(),
  };
}
function setPages(pages: ReturnType<typeof page>[]) {
  const getPage = vi.fn(async (number: number) => pages[number - 1]);
  mocked.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: pages.length, getPage }),
    destroy: mocked.destroy,
  });
  return getPage;
}
const file = () => new File(['fictional PDF'], '测试课程.pdf');
let ocrProgress: ReadOptions['onProgress'];
let canvases: { width: number; height: number; getContext: () => object }[];

beforeEach(() => {
  vi.resetAllMocks();
  ocrProgress = undefined;
  canvases = [];
  vi.stubGlobal('window', {
    location: { href: 'http://127.0.0.1:15473/' },
    document: {
      createElement: () => {
        const canvas = { width: 0, height: 0, getContext: () => ({}) };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  mocked.parse.mockImplementation((tokens: PositionedText[], source: string) =>
    tokens.length ? [complete(source)] : [],
  );
  mocked.createOcr.mockImplementation(async (options: ReadOptions) => {
    ocrProgress = options.onProgress;
    ocrProgress?.({ stage: '正在准备本地识别资源…', progress: 0 });
    return { recognize: mocked.recognize, close: mocked.close };
  });
  mocked.recognize.mockImplementation(async (_canvas: HTMLCanvasElement, source: string) => {
    for (const progress of [0, 0.5, 1]) ocrProgress?.({ stage: '正在离线识别课程文字…', progress });
    return [complete(source)];
  });
});
afterEach(() => vi.unstubAllGlobals());

function expectMonotonic(values: ImportProgress[]) {
  expect(values.map((value) => value.progress)).toEqual(
    values.map((value) => value.progress).sort((a, b) => a - b),
  );
  expect(values.every((value) => value.progress < 1)).toBe(true);
}

it('finishes each text page without OCR and reserves final progress for merging', async () => {
  const pages = [page('测试课程一'), page('测试课程二'), page('测试课程三')];
  setPages(pages);
  const values: ImportProgress[] = [];
  const result = await readPdf(file(), { onProgress: (value) => values.push(value) });
  expect(result.drafts).toHaveLength(3);
  expect(result.sources).toHaveLength(3);
  expect(result.warnings).toEqual([]);
  expect(mocked.createOcr).not.toHaveBeenCalled();
  expectMonotonic(values);
  expect(values.filter((value) => value.stage.includes('第 1 页')).at(-1)?.progress).toBeCloseTo(
    0.35,
  );
  expect(values.filter((value) => value.stage.includes('第 2 页')).at(-1)?.progress).toBeCloseTo(
    0.65,
  );
  expect(values.filter((value) => value.stage.includes('第 3 页')).at(-1)?.progress).toBeCloseTo(
    0.95,
  );
  expect(values.at(-1)).toEqual({ stage: 'PDF 识别完成，正在合并课程…', progress: 0.97 });
  for (const item of pages) {
    expect(item.cleanup).toHaveBeenCalledTimes(1);
    expect(item.render).not.toHaveBeenCalled();
  }
  expect(mocked.destroy).toHaveBeenCalledTimes(1);
});

it('keeps OCR retries inside their page interval and reuses one worker across scanned pages', async () => {
  const pages = [page(), page()];
  setPages(pages);
  const values: ImportProgress[] = [];
  let calls = 0;
  mocked.recognize.mockImplementation(async (_canvas: HTMLCanvasElement, source: string) => {
    for (const progress of [0, 0.5, 1]) ocrProgress?.({ stage: '正在离线识别课程文字…', progress });
    return ++calls === 1 ? [] : [complete(source)];
  });
  const result = await readPdf(file(), { onProgress: (value) => values.push(value) });
  expect(result.drafts).toHaveLength(2);
  expect(result.warnings).toHaveLength(2);
  expect(mocked.createOcr).toHaveBeenCalledTimes(1);
  expect(mocked.recognize).toHaveBeenCalledTimes(3);
  expect(pages[0].render).toHaveBeenCalledTimes(2);
  expect(pages[1].render).toHaveBeenCalledTimes(1);
  expect(pages[0].render.mock.calls[0][0].canvas).toBe(pages[0].render.mock.calls[1][0].canvas);
  expect(pages[0].getViewport.mock.calls.map(([argument]) => argument.scale)).toEqual([1, 1, 2.5]);
  expectMonotonic(values);
  const first = values.filter((value) => value.stage.includes('第 1 页'));
  const second = values.filter((value) => value.stage.includes('第 2 页'));
  expect(first.every((value) => value.progress <= 0.5)).toBe(true);
  expect(first.at(-1)?.progress).toBe(0.5);
  expect(second[0].progress).toBe(0.5);
  expect(second.at(-1)?.progress).toBeCloseTo(0.95);
  expect(values.some((value) => value.stage === '正在离线识别课程文字…')).toBe(false);
  expect(canvases.every((canvas) => !canvas.width && !canvas.height)).toBe(true);
  expect(mocked.close).toHaveBeenCalledTimes(1);
  expect(mocked.destroy).toHaveBeenCalledTimes(1);
});

it('uses the actual selected page number while progress spans only the selected pages', async () => {
  const getPage = setPages([page('一'), page('二'), page('三'), page('四')]);
  const values: ImportProgress[] = [];
  const result = await readPdf(file(), {
    selection: [1, 3],
    onProgress: (value) => values.push(value),
  });
  expect(getPage.mock.calls.map(([number]) => number)).toEqual([2, 4]);
  expect(result.drafts).toHaveLength(2);
  expect(result.sources).toHaveLength(4);
  expect(values.some((value) => value.stage.includes('第 2 页（1/2）'))).toBe(true);
  expect(values.some((value) => value.stage.includes('第 4 页（2/2）'))).toBe(true);
  expect(values.filter((value) => value.stage.includes('第 2 页')).at(-1)?.progress).toBe(0.5);
  expectMonotonic(values);
});

it('switches from text extraction to OCR without resetting progress for the next page', async () => {
  setPages([page('文字测试课程'), page()]);
  const values: ImportProgress[] = [];
  const result = await readPdf(file(), { onProgress: (value) => values.push(value) });
  expect(result.drafts).toHaveLength(2);
  expect(mocked.recognize).toHaveBeenCalledTimes(1);
  expect(
    values
      .filter((value) => value.stage.includes('第 2 页'))
      .every((value) => value.progress >= 0.5),
  ).toBe(true);
  expectMonotonic(values);
});

it('ignores progress after cancellation and releases the page, canvas, worker, and document', async () => {
  const item = page();
  setPages([item]);
  const controller = new AbortController();
  const values: ImportProgress[] = [];
  mocked.recognize.mockImplementation(async () => {
    ocrProgress?.({ stage: '正在离线识别课程文字…', progress: 0.5 });
    controller.abort();
    ocrProgress?.({ stage: '正在离线识别课程文字…', progress: 1 });
    throw new DOMException('已取消导入', 'AbortError');
  });
  await expect(
    readPdf(file(), {
      signal: controller.signal,
      onProgress: (value) => values.push(value),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const before = values.length;
  ocrProgress?.({ stage: '正在离线识别课程文字…', progress: 1 });
  expect(values).toHaveLength(before);
  expect(values.some((value) => value.stage.includes('识别完成'))).toBe(false);
  expect(item.cleanup).toHaveBeenCalledTimes(1);
  expect(canvases.every((canvas) => !canvas.width && !canvas.height)).toBe(true);
  expect(mocked.close).toHaveBeenCalledTimes(1);
  expect(mocked.destroy).toHaveBeenCalled();
});

it('does not mark a failed scan as complete and preserves cleanup', async () => {
  const item = page();
  setPages([item]);
  const values: ImportProgress[] = [];
  mocked.recognize.mockRejectedValue(new Error('测试 OCR 超时'));
  await expect(readPdf(file(), { onProgress: (value) => values.push(value) })).rejects.toThrow(
    '测试 OCR 超时',
  );
  expect(values.some((value) => value.stage.includes('识别完成'))).toBe(false);
  expect(item.cleanup).toHaveBeenCalledTimes(1);
  expect(canvases.every((canvas) => !canvas.width && !canvas.height)).toBe(true);
  expect(mocked.close).toHaveBeenCalledTimes(1);
  expect(mocked.destroy).toHaveBeenCalledTimes(1);
});
