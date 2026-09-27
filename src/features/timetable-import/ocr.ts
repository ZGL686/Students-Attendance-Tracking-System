import { abortable, checkAborted, offlineUrl } from './model';
import type { CourseDraft, ReadOptions } from './model';
import { parsePositionedText, parseTextBlocks } from './parse';
import type { PositionedText } from './parse';

export async function createOcr(options: ReadOptions): Promise<{
  recognize: (image: HTMLCanvasElement, source: string) => Promise<CourseDraft[]>;
  close: () => Promise<void>;
}> {
  const { signal, onProgress } = options;
  checkAborted(signal);
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  checkAborted(signal);
  onProgress?.({ stage: '正在加载本地中文识别引擎…', progress: 0.05 });
  const pending = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
    workerPath: offlineUrl('ocr/worker.min.js'),
    corePath: offlineUrl('ocr/core/'),
    langPath: offlineUrl('ocr/lang'),
    workerBlobURL: false,
    gzip: true,
    logger: (message) =>
      onProgress?.({
        stage:
          message.status === 'recognizing text' ? '正在离线识别课程文字…' : '正在准备本地识别资源…',
        progress: Math.min(1, Math.max(0, message.progress)),
      }),
  });
  const worker = await abortable(pending, signal, () => {
    void pending.then((value) => value.terminate()).catch(() => {});
  });
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      await worker.terminate();
    }
  };
  try {
    checkAborted(signal);
    await abortable(
      worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      }),
      signal,
      () => {
        void close();
      },
    );
  } catch (error) {
    await close();
    throw error;
  }
  return {
    close,
    recognize: async (image, source) => {
      checkAborted(signal);
      if (closed) throw new DOMException('已取消导入。', 'AbortError');
      const result = await abortable(
        worker.recognize(image, {}, { text: true, blocks: true }),
        signal,
        () => {
          void close();
        },
      );
      checkAborted(signal);
      const tokens: PositionedText[] = [];
      for (const block of result.data.blocks ?? [])
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines)
            for (const word of line.words)
              tokens.push({
                text: word.text,
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0,
                confidence: word.confidence,
              });
        }
      return tokens.length
        ? parsePositionedText(tokens, source)
        : parseTextBlocks(result.data.text, source);
    },
  };
}

export async function imageCanvas(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  checkAborted(signal);
  const bitmap = await createImageBitmap(file);
  try {
    checkAborted(signal);
    if (bitmap.width * bitmap.height > 24_000_000)
      throw new Error('图片像素过大，请裁剪课表区域后重试（最多 2400 万像素）。');
    const canvas = document.createElement('canvas');
    // Preserve the source pixels. Interpolating an already legible screenshot can
    // turn Chinese strokes into shapes the OCR model recognizes as Latin glyphs.
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片识别画布。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}
