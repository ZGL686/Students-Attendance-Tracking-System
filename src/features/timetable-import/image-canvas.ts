import { checkAborted } from './model';
import { withTaskTimeout } from './task-timeout';

const DECODE_TIMEOUT = 15_000;
const MAX_PIXELS = 24_000_000;

function renderImage(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('图片尺寸无效，无法解码。');
  if (width * height > MAX_PIXELS)
    throw new Error('图片像素过大，请裁剪课表区域后重试（最多 2400 万像素）。');
  const canvas = document.createElement('canvas');
  try {
    // Keep the source resolution: interpolation can erase small Chinese strokes.
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片识别画布。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return canvas;
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
}

async function decodeBitmap(file: File, signal?: AbortSignal): Promise<ImageBitmap> {
  let stopped = false;
  const pending = Promise.resolve()
    .then(() => {
      checkAborted(signal);
      return createImageBitmap(file);
    })
    .then((bitmap) => {
      // Browser decoding cannot be terminated; dispose of a result arriving after cancellation.
      if (stopped) {
        bitmap.close();
        throw new DOMException('已取消导入。', 'AbortError');
      }
      return bitmap;
    });
  return withTaskTimeout(
    pending,
    signal,
    DECODE_TIMEOUT,
    () => {
      stopped = true;
    },
    '图片解码超过 15 秒，正在尝试兼容方式。',
  );
}

async function decodeElement(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  checkAborted(signal);
  let image: HTMLImageElement | undefined;
  let url: string | undefined;
  const release = () => {
    if (image) {
      const released = image;
      image = undefined;
      released.onload = null;
      released.onerror = null;
      try {
        released.src = '';
      } catch {
        // Revoking the owned URL must still happen if a WebView rejects the empty source.
      }
    }
    if (url !== undefined) {
      URL.revokeObjectURL(url);
      url = undefined;
    }
  };
  try {
    url = URL.createObjectURL(file);
    image = new Image();
    const pending = new Promise<void>((resolve, reject) => {
      image!.onload = () => resolve();
      image!.onerror = () => reject(new Error('无法解码此图片，请检查文件是否完整。'));
      image!.src = url!;
    });
    await withTaskTimeout(
      pending,
      signal,
      DECODE_TIMEOUT,
      release,
      '图片解码超过 15 秒，请重新选择或裁剪图片后重试。',
    );
    checkAborted(signal);
    return renderImage(image, image.naturalWidth, image.naturalHeight);
  } finally {
    release();
  }
}

/** Decode locally with WebView-compatible fallback and bounded cancellation. */
export async function imageCanvas(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  checkAborted(signal);
  try {
    let bitmap: ImageBitmap | undefined;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await decodeBitmap(file, signal);
      } catch (error) {
        checkAborted(signal);
        if (error instanceof Error && error.name === 'AbortError') throw error;
        // Some Android WebViews fail this API while ordinary image loading still works.
      }
    }
    if (!bitmap) return await decodeElement(file, signal);
    try {
      checkAborted(signal);
      return renderImage(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    checkAborted(signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(
      `图片“${file.name}” · 解码失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
