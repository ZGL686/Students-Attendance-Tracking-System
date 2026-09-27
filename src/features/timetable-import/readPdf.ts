import type { PDFDocumentProxy } from 'pdfjs-dist';
import { abortable, checkAborted, offlineUrl } from './model';
import type { CourseDraft, ImportSource, ReadOptions } from './model';
import { createOcr } from './ocr';
import { parsePositionedText } from './parse';
import type { PositionedText } from './parse';

async function openPdf(file: File, signal?: AbortSignal) {
  checkAborted(signal);
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = offlineUrl('pdf/pdf.worker.min.mjs');
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAborted(signal);
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: offlineUrl('pdf/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: offlineUrl('pdf/standard_fonts/'),
    wasmUrl: offlineUrl('pdf/wasm/'),
  });
  try {
    const document = await abortable(task.promise, signal, () => {
      void task.destroy();
    });
    if (document.numPages > 50) {
      await task.destroy();
      throw new Error('PDF 超过 50 页，请先导出需要的课表页面。');
    }
    return { document, task, pdfjs };
  } catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('PDF 有密码保护，请先另存为无密码的课表 PDF。');
    throw error;
  }
}

function sourcesFor(document: PDFDocumentProxy): ImportSource[] {
  return Array.from({ length: document.numPages }, (_, index) => ({
    index,
    label: `第 ${index + 1} 页`,
  }));
}

export async function inspectPdf(file: File, signal?: AbortSignal): Promise<ImportSource[]> {
  const { document, task } = await openPdf(file, signal);
  try {
    return sourcesFor(document);
  } finally {
    await task.destroy();
  }
}

export async function readPdf(
  file: File,
  options: ReadOptions,
): Promise<{
  drafts: CourseDraft[];
  sources: ImportSource[];
  warnings: string[];
}> {
  const { signal, onProgress, selection } = options;
  onProgress?.({ stage: '正在读取 PDF…', progress: 0.05 });
  const { document: pdf, task, pdfjs } = await openPdf(file, signal);
  const sources = sourcesFor(pdf);
  const chosen = sources.filter((source) => !selection || selection.includes(source.index));
  const drafts: CourseDraft[] = [],
    warnings: string[] = [];
  let ocr: Awaited<ReturnType<typeof createOcr>> | undefined;
  const cancelDocument = () => {
    void task.destroy();
  };
  signal?.addEventListener('abort', cancelDocument, { once: true });
  try {
    for (let index = 0; index < chosen.length; index++) {
      checkAborted(signal);
      const source = chosen[index];
      onProgress?.({
        stage: `正在分析 PDF 第 ${source.index + 1} 页…`,
        progress: index / chosen.length,
      });
      const page = await abortable(pdf.getPage(source.index + 1), signal);
      try {
        const label = `${file.name} · 第 ${source.index + 1} 页`;
        const viewport = page.getViewport({ scale: 1 });
        const content = await abortable(page.getTextContent(), signal);
        const tokens: PositionedText[] = content.items.flatMap((item) => {
          if (!('str' in item) || !item.str.trim()) return [];
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.abs(item.height) || Math.hypot(transform[2], transform[3]);
          return [
            {
              text: item.str,
              x: transform[4],
              y: transform[5] - height,
              width: Math.abs(item.width),
              height,
            },
          ];
        });
        const extracted = parsePositionedText(tokens, label);
        // Text layers may be missing, contain broken CMaps, or cover only a page heading.
        if (
          extracted.some((draft) => draft.name && draft.day && draft.weeks) &&
          !tokens.some((token) => /\uFFFD/.test(token.text))
        ) {
          drafts.push(...extracted);
          continue;
        }
        ocr ??= await createOcr(options);
        const maxScale = Math.sqrt(16_000_000 / (viewport.width * viewport.height));
        if (!Number.isFinite(maxScale) || maxScale <= 0) throw new Error('PDF 页面尺寸无效。');
        const canvas = window.document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建 PDF 识别画布。');
        try {
          let recognized: CourseDraft[] = [];
          const score = (items: CourseDraft[]) =>
            items.reduce((total, item) => {
              const fields = [item.name, item.day, item.start, item.end, item.weeks].filter(
                Boolean,
              ).length;
              return total + (fields === 5 ? 100 : 0) + fields / Math.max(1, items.length);
            }, 0);
          // Preserve low-resolution scans first; higher-resolution rendering is
          // useful for small PDF text, but interpolation can damage existing pixels.
          for (const scale of [...new Set([Math.min(1, maxScale), Math.min(2.5, maxScale)])]) {
            const rendered = page.getViewport({ scale });
            canvas.width = Math.ceil(rendered.width);
            canvas.height = Math.ceil(rendered.height);
            const render = page.render({ canvas, canvasContext: context, viewport: rendered });
            await abortable(render.promise, signal, () => render.cancel());
            const candidate = await ocr.recognize(canvas, label);
            if (score(candidate) > score(recognized)) recognized = candidate;
            if (
              recognized.some(
                (draft) => draft.name && draft.day && draft.start && draft.end && draft.weeks,
              )
            )
              break;
          }
          drafts.push(...(recognized.length ? recognized : extracted));
          if (!recognized.length && !extracted.length)
            warnings.push(`第 ${source.index + 1} 页未识别到课程，请手动补充。`);
          else warnings.push(`第 ${source.index + 1} 页使用了离线图片识别，请核对课程信息。`);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        page.cleanup();
      }
    }
    return { drafts, sources, warnings };
  } finally {
    signal?.removeEventListener('abort', cancelDocument);
    await ocr?.close();
    await task.destroy();
  }
}
