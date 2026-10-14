import { checkAborted, offlineUrl } from './model';
import type { CourseDraft, ReadOptions } from './model';
import { parsePositionedText, parseTextBlocks } from './parse';
import type { PositionedText } from './parse';
import type { ImageRect } from './image-layout';
import { createManagedOcrWorker } from './managed-ocr-worker';
import type { ManagedOcrWorker } from './managed-ocr-worker';

export { imageCanvas } from './image-canvas';

export type OcrText = { text: string; tokens: PositionedText[]; confidence: number };
export type OcrMode = 'block' | 'line' | 'sparse' | 'digits';

// PDF canvases change between renders, so PNG reuse stays opt-in for immutable images.
export async function createOcr(
  options: ReadOptions,
  immutableImages = false,
): Promise<{
  recognize: (image: HTMLCanvasElement, source: string) => Promise<CourseDraft[]>;
  scan: (
    image: HTMLCanvasElement,
    region?: ImageRect,
    scale?: number,
    mode?: OcrMode,
  ) => Promise<OcrText>;
  close: () => Promise<void>;
  finishImageAnalysis: () => Promise<void>;
}> {
  const { signal, onProgress } = options;
  checkAborted(signal);
  const { PSM } = await import('tesseract.js');
  checkAborted(signal);
  onProgress?.({ stage: '正在加载本地中文识别引擎…', progress: 0.05 });
  const lifetime = new AbortController();
  const onAbort = () => lifetime.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) lifetime.abort();
  let closed = false;
  let worker: ManagedOcrWorker | undefined;
  let chineseWorker: ManagedOcrWorker | undefined;
  let digitsWorker: ManagedOcrWorker | undefined;
  const settings = {
    workerPath: offlineUrl('ocr/worker.min.js'),
    corePath: offlineUrl('ocr/core/'),
    langPath: offlineUrl('ocr/lang'),
    cacheImages: immutableImages,
    signal: lifetime.signal,
    onProgress: (message: { status: string; progress: number }) => {
      if (closed || lifetime.signal.aborted) return;
      onProgress?.({
        stage:
          message.status === 'recognizing text' ? '正在离线识别课程文字…' : '正在准备本地识别资源…',
        progress: Math.min(1, Math.max(0, message.progress)),
      });
    },
  };
  const close = async () => {
    if (!closed) {
      closed = true;
      lifetime.abort();
      signal?.removeEventListener('abort', onAbort);
      await Promise.allSettled([
        worker?.terminate(),
        chineseWorker?.terminate(),
        digitsWorker?.terminate(),
      ]);
    }
  };
  try {
    checkAborted(signal);
    worker = await createManagedOcrWorker('chi_sim+eng', settings);
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
    });
  } catch (error) {
    await close();
    throw error;
  }
  const scan = async (
    image: HTMLCanvasElement,
    region?: ImageRect,
    scale = 1,
    mode: OcrMode = 'block',
  ): Promise<OcrText> => {
    checkAborted(signal);
    if (closed) throw new DOMException('已取消导入。', 'AbortError');
    let activeWorker: ManagedOcrWorker;
    if (mode === 'digits') {
      // Keep the small English model ready instead of reinitializing Chinese for every room.
      digitsWorker ??= await createManagedOcrWorker('eng', settings);
      activeWorker = digitsWorker;
    } else if (region) {
      // Fixed languages avoid repeated WASM reinitialization while keeping regional Chinese accuracy.
      chineseWorker ??= await createManagedOcrWorker('chi_sim', settings);
      activeWorker = chineseWorker;
    } else {
      if (!worker) throw new Error('图片版式分析已经结束，请重新启动导入。');
      activeWorker = worker!;
    }
    await activeWorker.setParameters({
      preserve_interword_spaces: '1',
      tessedit_pageseg_mode:
        mode === 'line' || mode === 'digits'
          ? PSM.SINGLE_LINE
          : mode === 'sparse'
            ? PSM.SPARSE_TEXT
            : PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: mode === 'digits' ? '0123456789-' : '',
    });
    let crop: HTMLCanvasElement | undefined;
    try {
      if (region) {
        crop = document.createElement('canvas');
        crop.width = Math.round(region.width * scale);
        crop.height = Math.round(region.height * scale);
        const context = crop.getContext('2d');
        if (!context) throw new Error('无法创建局部识别画布。');
        context.drawImage(
          image,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          crop.width,
          crop.height,
        );
      }
      const result = await activeWorker.recognize(
        crop ?? image,
        region && !crop
          ? {
              left: region.x,
              top: region.y,
              width: region.width,
              height: region.height,
            }
          : undefined,
      );
      checkAborted(signal);
      const tokens: PositionedText[] = [];
      for (const block of result.blocks ?? [])
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines)
            for (const word of line.words)
              tokens.push({
                text: word.text,
                x: crop ? word.bbox.x0 / scale + region!.x : word.bbox.x0,
                y: crop ? word.bbox.y0 / scale + region!.y : word.bbox.y0,
                width: (word.bbox.x1 - word.bbox.x0) / (crop ? scale : 1),
                height: (word.bbox.y1 - word.bbox.y0) / (crop ? scale : 1),
                confidence: word.confidence,
              });
        }
      return { text: result.text, tokens, confidence: result.confidence };
    } finally {
      if (crop) {
        crop.width = 0;
        crop.height = 0;
      }
    }
  };
  return {
    close,
    finishImageAnalysis: async () => {
      if (immutableImages) {
        await worker?.terminate();
        worker = undefined;
      }
    },
    scan,
    recognize: async (image, source) => {
      const result = await scan(image);
      return result.tokens.length
        ? parsePositionedText(result.tokens, source)
        : parseTextBlocks(result.text, source);
    },
  };
}
