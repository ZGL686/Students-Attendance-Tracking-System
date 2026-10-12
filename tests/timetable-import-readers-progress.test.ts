import { beforeEach, expect, it, vi } from 'vitest';
import { readImportFiles } from '../src/features/timetable-import/read';
import { createEmptyDraft } from '../src/features/timetable-import/model';
import type {
  CourseCatalogEntry,
  ImportProgress,
  ImportResult,
  ReadOptions,
} from '../src/features/timetable-import/model';

const readers = vi.hoisted(() => ({
  images: vi.fn(),
  excel: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock('../src/features/timetable-import/readImages', () => ({ readImages: readers.images }));
vi.mock('../src/features/timetable-import/readExcel', () => ({ readExcel: readers.excel }));
vi.mock('../src/features/timetable-import/readPdf', () => ({ readPdf: readers.pdf }));

const image = (name = '课表.jpg') => new File(['fictional image'], name, { type: 'image/jpeg' });
const document = (name: string) => new File(['fictional document'], name);
function result(name: string): ImportResult {
  return {
    drafts: [{ ...createEmptyDraft(name), name }],
    sources: [{ index: 0, label: name }],
    warnings: [],
  };
}
function resetProgress(options: ReadOptions) {
  for (const progress of [0, 0.5, 1, 0, Number.NaN, 0.7, 1])
    options.onProgress?.({ stage: '正在识别本地内容…', progress });
}

beforeEach(() => {
  vi.resetAllMocks();
  readers.images.mockImplementation(async (_files: File[], options: ReadOptions) => {
    resetProgress(options);
    return result('图片测试课程');
  });
  readers.excel.mockImplementation(async (_file: File, options: ReadOptions) => {
    resetProgress(options);
    return result('表格测试课程');
  });
  readers.pdf.mockImplementation(async (_file: File, options: ReadOptions) => {
    resetProgress(options);
    return result('PDF测试课程');
  });
});

it('merges every image and document while mapping each group into monotonic batch progress', async () => {
  const values: ImportProgress[] = [];
  const files = [
    document('课程.csv'),
    image('课表一.jpg'),
    document('课表.pdf'),
    image('课表二.jpg'),
  ];
  const batch = await readImportFiles(files, { onProgress: (value) => values.push(value) });
  expect(readers.images).toHaveBeenCalledTimes(1);
  expect(readers.images.mock.calls[0][0]).toEqual([files[1], files[3]]);
  expect(readers.images.mock.invocationCallOrder[0]).toBeLessThan(
    readers.excel.mock.invocationCallOrder[0],
  );
  expect(readers.excel).toHaveBeenCalledTimes(1);
  expect(readers.pdf).toHaveBeenCalledTimes(1);
  expect(batch.drafts.map((draft) => draft.name)).toEqual([
    '图片测试课程',
    '表格测试课程',
    'PDF测试课程',
  ]);
  expect(batch.sources).toHaveLength(3);
  expect(values.map((value) => value.progress)).toEqual(
    values.map((value) => value.progress).sort((a, b) => a - b),
  );
  expect(values.every((value) => Number.isFinite(value.progress) && value.progress < 1)).toBe(true);
  expect(
    Math.max(
      ...values.filter((value) => value.stage.includes('2 张图片')).map((value) => value.progress),
    ),
  ).toBe(0.475);
  expect(values.find((value) => value.stage.startsWith('正在读取文件“课程.csv”'))?.progress).toBe(
    0.475,
  );
  expect(
    values.find((value) => value.stage.startsWith('正在读取文件“课表.pdf”'))?.progress,
  ).toBeCloseTo(0.7125);
  expect(values.at(-1)).toEqual({ stage: '识别完成，正在自动导入。', progress: 0.97 });
});

it('ignores finished group callbacks while subsequent files are being read', async () => {
  const values: ImportProgress[] = [];
  let finishedImageProgress: ReadOptions['onProgress'];
  readers.images.mockImplementation(async (_files: File[], options: ReadOptions) => {
    finishedImageProgress = options.onProgress;
    return result('图片测试课程');
  });
  readers.pdf.mockImplementation(async (_file: File, options: ReadOptions) => {
    const before = values.length;
    finishedImageProgress?.({ stage: '不应出现的晚回调', progress: 1 });
    expect(values).toHaveLength(before);
    options.onProgress?.({ stage: '正在读取第 2 页', progress: 0.5 });
    return result('PDF测试课程');
  });
  await readImportFiles([image(), document('课表.pdf')], {
    onProgress: (value) => values.push(value),
  });
  const before = values.length;
  finishedImageProgress?.({ stage: '结束后的晚回调', progress: 1 });
  expect(values).toHaveLength(before);
  expect(values.some((value) => value.stage.includes('晚回调'))).toBe(false);
});

it('stops reporting and rejects the batch when cancellation happens inside a reader', async () => {
  const controller = new AbortController();
  const values: ImportProgress[] = [];
  readers.images.mockImplementation(async (_files: File[], options: ReadOptions) => {
    options.onProgress?.({ stage: '正在识别图片', progress: 0.2 });
    controller.abort();
    options.onProgress?.({ stage: '取消后的晚回调', progress: 1 });
    return result('图片测试课程');
  });
  await expect(
    readImportFiles([image(), document('课程.csv')], {
      signal: controller.signal,
      onProgress: (value) => values.push(value),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(readers.excel).not.toHaveBeenCalled();
  expect(values.at(-1)?.stage).toBe('1 张图片 · 正在识别图片');
  expect(values.some((value) => value.stage.includes('识别完成'))).toBe(false);
});

it('rejects a failed document without returning a partial batch or reporting completion', async () => {
  const values: ImportProgress[] = [];
  let failedProgress: ReadOptions['onProgress'];
  readers.pdf.mockImplementation(async (_file: File, options: ReadOptions) => {
    failedProgress = options.onProgress;
    options.onProgress?.({ stage: '正在读取 PDF', progress: 0.2 });
    throw new Error('测试文件无法读取');
  });
  await expect(
    readImportFiles([image(), document('损坏.pdf'), document('课程.csv')], {
      onProgress: (value) => values.push(value),
    }),
  ).rejects.toThrow('测试文件无法读取');
  expect(readers.excel).not.toHaveBeenCalled();
  expect(values.some((value) => value.stage === '识别完成，正在自动导入。')).toBe(false);
  const before = values.length;
  failedProgress?.({ stage: '失败后的晚回调', progress: 1 });
  expect(values).toHaveLength(before);
});

it('keeps catalog-only references temporary and requests scheduling images', async () => {
  const catalog: CourseCatalogEntry[] = [
    {
      code: 'TEST001',
      name: '目录测试课程',
      teacher: '测试老师',
      source: '目录测试.jpg',
      fieldConfidence: { name: 95, teacher: 95 },
    },
  ];
  const values: ImportProgress[] = [];
  readers.images.mockResolvedValue({ drafts: [], sources: [], warnings: [], catalog });
  const batch = await readImportFiles([image('目录测试.jpg')], {
    catalog: [],
    onProgress: (value) => values.push(value),
  });
  expect(batch.drafts).toEqual([]);
  expect(batch.catalog).toEqual(catalog);
  expect(values.at(-1)).toEqual({ stage: '课程目录识别完成，请补选课表图片。', progress: 0.97 });
});

it('validates every file before starting readers and forwards selection and cancellation options', async () => {
  await expect(readImportFiles([image(), document('旧课程.xls')])).rejects.toThrow('.xlsx');
  expect(readers.images).not.toHaveBeenCalled();
  const controller = new AbortController();
  const selection = [1, 2];
  await readImportFiles([document('课程.xlsx'), document('课表.pdf')], {
    signal: controller.signal,
    selection,
  });
  for (const reader of [readers.excel, readers.pdf]) {
    expect(reader.mock.calls[0][1].selection).toEqual(selection);
    expect(reader.mock.calls[0][1].signal).toBe(controller.signal);
  }
});
