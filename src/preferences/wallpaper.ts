const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_STORED_BYTES = 2_100_000;

function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.type === 'image/webp') resolve(blob);
        else reject(new Error('当前设备无法压缩此图片格式，请另存为 JPG、PNG 或 WebP 后重试。'));
      },
      'image/webp',
      quality,
    );
  });
}

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取压缩后的壁纸图片。'));
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/webp;base64,'))
        resolve(reader.result);
      else reject(new Error('壁纸图片格式转换失败，请换一张图片后重试。'));
    };
    reader.readAsDataURL(blob);
  });
}

/** Decode and compress a user image before saving it in device-only preferences. */
export async function prepareWallpaper(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml')
    throw new Error('请选择 JPG、PNG、WebP 或 BMP 图片。');
  if (!file.size) throw new Error('图片文件为空，请重新选择。');
  if (file.size > MAX_INPUT_BYTES) throw new Error('图片不能超过 20 MB，请先压缩后再导入。');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法打开这张图片，请换成 JPG、PNG、WebP 或 BMP 格式。');
  }

  const canvas = document.createElement('canvas');
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('图片尺寸无效，请换一张图片。');
    let scale = Math.min(1, 1440 / bitmap.width, 2560 / bitmap.height);
    let compressed: Blob | undefined;
    for (const quality of [0.82, 0.74, 0.66]) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法准备壁纸图片，请重启应用后重试。');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      compressed = await encodeWebp(canvas, quality);
      if (compressed.size <= MAX_STORED_BYTES) break;
      scale *= 0.78;
    }
    if (!compressed || compressed.size > MAX_STORED_BYTES)
      throw new Error('这张图片压缩后仍过大，请选择尺寸较小的图片。');
    return await asDataUrl(compressed);
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
