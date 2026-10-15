import { checkAborted } from './model';
import type { ImportResult, ImportSource, ReadOptions } from './model';
import { courseImportAccept, tableImportOnly } from './import-policy';

declare const __LUDIAN_TABLE_IMPORT_ONLY__: boolean;

export const importAccept = courseImportAccept;

function kind(file: File): 'image' | 'excel' | 'pdf' {
  if (file.size > 20 * 1024 * 1024)
    throw new Error('课表文件不能超过 20 MB，请裁剪或只保留需要的页面。');
  if (!file.size) throw new Error('文件内容为空，请重新选择。');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'xlsx' || extension === 'csv') return 'excel';
  if (extension === 'xls') throw new Error('暂不支持旧版 .xls，请另存为 Excel（.xlsx）后导入。');
  if (tableImportOnly)
    throw new Error(
      `“${file.name}”不是支持的课表文件。请选择 Excel（.xlsx）或 CSV；手机不支持图片和 PDF 识别。`,
    );
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension ?? '')) return 'image';
  if (file.type.startsWith('image/')) return 'image';
  if (extension === 'pdf') return 'pdf';
  throw new Error('请选择 PNG、JPG、WebP、BMP 图片、Excel（.xlsx）、CSV 或 PDF 文件。');
}

export async function inspectImportFile(
  file: File,
  options: Pick<ReadOptions, 'signal'> = {},
): Promise<ImportSource[]> {
  checkAborted(options.signal);
  switch (kind(file)) {
    case 'image':
      return [{ index: 0, label: '课表图片' }];
    case 'excel': {
      const { inspectExcel } = await import('./readExcel');
      return inspectExcel(file, options.signal);
    }
    case 'pdf': {
      if (typeof __LUDIAN_TABLE_IMPORT_ONLY__ !== 'undefined' && __LUDIAN_TABLE_IMPORT_ONLY__)
        throw new Error('手机课程导入仅支持 Excel / CSV。');
      if (tableImportOnly) throw new Error('手机课程导入仅支持 Excel / CSV。');
      const { inspectPdf } = await import('./readPdf');
      return inspectPdf(file, options.signal);
    }
  }
}

export async function readImportFile(file: File, options: ReadOptions = {}): Promise<ImportResult> {
  return readImportFiles([file], options);
}

/** Read a complete batch before the caller performs a single save transaction. */
export async function readImportFiles(
  files: File[],
  options: ReadOptions = {},
): Promise<ImportResult> {
  checkAborted(options.signal);
  if (!files.length) throw new Error('请先选择课程表图片或文件。');
  const kinds = files.map(kind);
  const images = files.filter((_, index) => kinds[index] === 'image');
  let completedFiles = 0,
    progress = 0,
    reading = true;
  const report = (stage: string, value: number) => {
    if (!reading || options.signal?.aborted) return;
    progress = Math.max(progress, Math.min(0.97, Math.max(0, value)));
    options.onProgress?.({ stage, progress });
  };
  const readGroup = async (
    label: string,
    count: number,
    reader: (scoped: ReadOptions) => Promise<ImportResult>,
  ) => {
    let active = true;
    const start = completedFiles;
    report(`正在读取${label}…`, (0.95 * start) / files.length);
    try {
      const group = await reader({
        ...options,
        onProgress: (next) => {
          if (!active) return;
          const local = Number.isFinite(next.progress)
            ? Math.min(1, Math.max(0, next.progress))
            : 0;
          report(`${label} · ${next.stage}`, (0.95 * (start + count * local)) / files.length);
        },
      });
      checkAborted(options.signal);
      completedFiles += count;
      report(`已识别${label}，正在合并课程…`, (0.95 * completedFiles) / files.length);
      return group;
    } finally {
      active = false;
    }
  };
  let result: ImportResult = {
    drafts: [],
    sources: [],
    warnings: [],
    catalog: options.catalog ?? [],
    documents: [],
  };
  try {
    if (
      (typeof __LUDIAN_TABLE_IMPORT_ONLY__ === 'undefined' || !__LUDIAN_TABLE_IMPORT_ONLY__) &&
      !tableImportOnly &&
      images.length
    ) {
      const { readImages } = await import('./readImages');
      result = await readGroup(`${images.length} 张图片`, images.length, (scoped) =>
        readImages(images, scoped),
      );
    }
    for (let index = 0; index < files.length; index++) {
      if (kinds[index] === 'image') continue;
      const document = await readGroup(`文件“${files[index].name}”`, 1, (scoped) =>
        readDocument(files[index], scoped),
      );
      result.drafts.push(...document.drafts);
      result.sources.push(...document.sources);
      result.warnings.push(...document.warnings);
      result.documents ??= [];
      result.documents.push(...(document.documents ?? []));
    }
    checkAborted(options.signal);
    if (!result.drafts.length && !result.catalog?.length && !result.documents?.length) {
      throw new Error('没有识别到课程，请换一张更清晰的课表图片或上传 Excel / CSV 文件。');
    }
    if (result.drafts.length) {
      result.warnings.push(
        ...(result.documents ?? [])
          .filter((document) => document.kind !== 'courses')
          .map((document) => `${document.source}：${document.message}`),
      );
      result.warnings = [...new Set(result.warnings)];
    }
    report(
      result.drafts.length
        ? tableImportOnly
          ? '读取完成，正在导入。'
          : '识别完成，正在自动导入。'
        : result.catalog?.length
          ? '课程目录识别完成，请补选课表图片。'
          : '文件检查完成。',
      0.97,
    );
    return result;
  } finally {
    reading = false;
  }
}

async function readDocument(file: File, options: ReadOptions): Promise<ImportResult> {
  checkAborted(options.signal);
  let result: ImportResult;
  switch (kind(file)) {
    case 'excel': {
      const { readExcel } = await import('./readExcel');
      result = { ...(await readExcel(file, options)), warnings: [] };
      break;
    }
    case 'pdf': {
      if (typeof __LUDIAN_TABLE_IMPORT_ONLY__ !== 'undefined' && __LUDIAN_TABLE_IMPORT_ONLY__)
        throw new Error('手机课程导入仅支持 Excel / CSV。');
      if (tableImportOnly) throw new Error('手机课程导入仅支持 Excel / CSV。');
      const { readPdf } = await import('./readPdf');
      result = await readPdf(file, options);
      break;
    }
    case 'image': {
      throw new Error('图片应通过批量识别入口处理。');
    }
  }
  checkAborted(options.signal);
  if (!result.drafts.length && !result.documents?.length) {
    throw new Error('没有识别到课程，请换一张更清晰的课表图片或上传 Excel / CSV 文件。');
  }
  return result;
}
