import { checkAborted } from './model';
import type { ImportResult, ImportSource, ReadOptions } from './model';

export const importAccept = '.png,.jpg,.jpeg,.webp,.bmp,.xlsx,.csv,.pdf';

function kind(file: File): 'image' | 'excel' | 'pdf' {
  if (file.size > 20 * 1024 * 1024)
    throw new Error('课表文件不能超过 20 MB，请裁剪或只保留需要的页面。');
  if (!file.size) throw new Error('文件内容为空，请重新选择。');
  const extension = file.name.toLowerCase().split('.').pop();
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension ?? '')) return 'image';
  if (file.type.startsWith('image/')) return 'image';
  if (extension === 'xlsx' || extension === 'csv') return 'excel';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'xls') throw new Error('暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx 后导入。');
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
      const { inspectPdf } = await import('./readPdf');
      return inspectPdf(file, options.signal);
    }
  }
}

export async function readImportFile(file: File, options: ReadOptions = {}): Promise<ImportResult> {
  checkAborted(options.signal);
  let result: ImportResult;
  switch (kind(file)) {
    case 'excel': {
      const { readExcel } = await import('./readExcel');
      result = { ...(await readExcel(file, options)), warnings: [] };
      break;
    }
    case 'pdf': {
      const { readPdf } = await import('./readPdf');
      result = await readPdf(file, options);
      break;
    }
    case 'image': {
      const { createOcr, imageCanvas } = await import('./ocr');
      const canvas = await imageCanvas(file, options.signal);
      let ocr: Awaited<ReturnType<typeof createOcr>> | undefined;
      try {
        ocr = await createOcr(options);
        result = {
          drafts: await ocr.recognize(canvas, file.name),
          sources: [{ index: 0, label: '课表图片' }],
          warnings: ['图片已在本机识别并自动导入；可在课程表查看结果。'],
        };
      } finally {
        await ocr?.close();
        canvas.width = 0;
        canvas.height = 0;
      }
      break;
    }
  }
  checkAborted(options.signal);
  if (!result.drafts.length) {
    throw new Error('没有识别到课程，请换一张更清晰的课表图片或上传 Excel / CSV 文件。');
  }
  options.onProgress?.({ stage: '识别完成，正在自动导入。', progress: 1 });
  return result;
}
