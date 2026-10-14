import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageCanvas } from '../src/features/timetable-import/image-canvas';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const file = () => new File(['fictional image'], 'fictional-course.png', { type: 'image/png' });
const bitmap = (width = 1132, height = 673) =>
  ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

class FakeImage {
  static instances: FakeImage[] = [];
  static load: ((image: FakeImage) => void) | undefined;
  naturalWidth = 1132;
  naturalHeight = 673;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  source = '';
  constructor() {
    FakeImage.instances.push(this);
  }
  set src(value: string) {
    this.source = value;
    if (value) FakeImage.load?.(this);
  }
  get src() {
    return this.source;
  }
}
type TestCanvas = {
  width: number;
  height: number;
  context: {
    fillStyle: string;
    fillRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
  };
  getContext: ReturnType<typeof vi.fn>;
};
let canvases: TestCanvas[];
let createCanvas: ReturnType<typeof vi.fn>;
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  canvases = [];
  createCanvas = vi.fn(() => {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    const canvas = { width: 0, height: 0, context, getContext: vi.fn(() => context) };
    canvases.push(canvas);
    return canvas;
  });
  createUrl = vi.fn(() => 'blob:fictional-image');
  revokeUrl = vi.fn();
  FakeImage.instances = [];
  FakeImage.load = (image) => queueMicrotask(() => image.onload?.());
  vi.stubGlobal('document', { createElement: createCanvas });
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap()),
  );
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const expectElementReleased = () => {
  expect(FakeImage.instances).toHaveLength(1);
  const image = FakeImage.instances[0];
  expect(image.src).toBe('');
  expect(image.onload).toBeNull();
  expect(image.onerror).toBeNull();
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:fictional-image');
};

describe('bounded local image decode', () => {
  it('keeps original resolution and white background and closes the decoded bitmap', async () => {
    const decoded = bitmap();
    const decode = vi.fn(async () => decoded);
    vi.stubGlobal('createImageBitmap', decode);
    const source = file();
    const canvas = await imageCanvas(source);
    expect(decode).toHaveBeenCalledExactlyOnceWith(source);
    expect(canvas.width).toBe(1132);
    expect(canvas.height).toBe(673);
    const context = canvases[0].context;
    expect(context.fillStyle).toBe('#fff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1132, 673);
    expect(context.drawImage).toHaveBeenCalledWith(decoded, 0, 0, 1132, 673);
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it.each(['missing', 'rejected', 'thrown'])(
    'falls back to the browser image loader when bitmap decoding is %s',
    async (kind) => {
      vi.stubGlobal(
        'createImageBitmap',
        kind === 'missing'
          ? undefined
          : vi.fn(() => {
              if (kind === 'thrown') throw new Error('WebView decode unsupported');
              return Promise.reject(new Error('WebView decode failed'));
            }),
      );
      const source = file();
      const canvas = await imageCanvas(source);
      expect(canvas.width).toBe(1132);
      expect(canvas.height).toBe(673);
      expect(createUrl).toHaveBeenCalledExactlyOnceWith(source);
      expect(canvases[0].context.drawImage).toHaveBeenCalledWith(
        FakeImage.instances[0],
        0,
        0,
        1132,
        673,
      );
      expectElementReleased();
    },
  );

  it('rejects cancellation before requesting either decode API', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(imageCanvas(file(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('cancels a pending bitmap immediately and closes its late result', async () => {
    const pendingBitmap = deferred<ImageBitmap>();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => pendingBitmap.promise),
    );
    const controller = new AbortController();
    const pending = imageCanvas(file(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    controller.abort();
    await rejected;
    const late = bitmap();
    pendingBitmap.resolve(late);
    await flush();
    expect(late.close).toHaveBeenCalledOnce();
    expect(createCanvas).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('falls back after a bitmap deadline and closes a late bitmap without using it', async () => {
    const pendingBitmap = deferred<ImageBitmap>();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => pendingBitmap.promise),
    );
    const pending = imageCanvas(file());
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toBe(canvases[0]);
    const late = bitmap();
    pendingBitmap.resolve(late);
    await flush();
    expect(late.close).toHaveBeenCalledOnce();
    expect(canvases).toHaveLength(1);
    expectElementReleased();
  });

  it('preserves a bitmap AbortError and does not try another decoder', async () => {
    const error = new DOMException('Decoder cancelled', 'AbortError');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(error)),
    );
    await expect(imageCanvas(file())).rejects.toBe(error);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('cancels a pending fallback and ignores a saved late onload callback', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    FakeImage.load = undefined;
    const controller = new AbortController();
    const pending = imageCanvas(file(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const onload = FakeImage.instances[0].onload!;
    controller.abort();
    await rejected;
    onload();
    await flush();
    expect(createCanvas).not.toHaveBeenCalled();
    expectElementReleased();
  });

  it('bounds a hung fallback and reports the filename and decode stage', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    FakeImage.load = undefined;
    const pending = imageCanvas(file());
    const rejected = expect(pending).rejects.toThrow(
      '图片“fictional-course.png” · 解码失败：图片解码超过 15 秒',
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(createCanvas).not.toHaveBeenCalled();
    expectElementReleased();
  });

  it('reports fallback load errors without returning an empty canvas', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    FakeImage.load = (image) => queueMicrotask(() => image.onerror?.());
    await expect(imageCanvas(file())).rejects.toThrow(
      '图片“fictional-course.png” · 解码失败：无法解码此图片',
    );
    expect(createCanvas).not.toHaveBeenCalled();
    expectElementReleased();
  });

  it.each(['bitmap', 'element'])('rejects images over 24 megapixels via %s', async (kind) => {
    const decoded = bitmap(6001, 4000);
    if (kind === 'bitmap')
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => decoded),
      );
    else {
      vi.stubGlobal('createImageBitmap', undefined);
      FakeImage.load = (image) => {
        image.naturalWidth = 6001;
        image.naturalHeight = 4000;
        queueMicrotask(() => image.onload?.());
      };
    }
    await expect(imageCanvas(file())).rejects.toThrow('最多 2400 万像素');
    expect(createCanvas).not.toHaveBeenCalled();
    if (kind === 'bitmap') expect(decoded.close).toHaveBeenCalledOnce();
    else expectElementReleased();
  });

  it('accepts the 24 megapixel boundary without downsampling', async () => {
    const decoded = bitmap(6000, 4000);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => decoded),
    );
    await expect(imageCanvas(file())).resolves.toMatchObject({ width: 6000, height: 4000 });
    expect(decoded.close).toHaveBeenCalledOnce();
  });

  it.each([0, -1, NaN, 1.5])('rejects invalid decoded width %s', async (width) => {
    const decoded = bitmap(width, 100);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => decoded),
    );
    await expect(imageCanvas(file())).rejects.toThrow('图片尺寸无效');
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it.each(['bitmap', 'element'])(
    'frees the canvas and decoded %s when a canvas context cannot be created',
    async (kind) => {
      const decoded = bitmap();
      if (kind === 'bitmap')
        vi.stubGlobal(
          'createImageBitmap',
          vi.fn(async () => decoded),
        );
      else vi.stubGlobal('createImageBitmap', undefined);
      createCanvas.mockImplementationOnce(() => {
        const canvas = {
          width: 0,
          height: 0,
          context: { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() },
          getContext: vi.fn(() => null),
        };
        canvases.push(canvas);
        return canvas;
      });
      await expect(imageCanvas(file())).rejects.toThrow('无法创建图片识别画布');
      expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
      if (kind === 'bitmap') expect(decoded.close).toHaveBeenCalledOnce();
      else expectElementReleased();
    },
  );

  it('releases the bitmap and allocated pixels if drawing fails', async () => {
    const decoded = bitmap();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => decoded),
    );
    createCanvas.mockImplementationOnce(() => {
      const context = {
        fillStyle: '',
        fillRect: vi.fn(),
        drawImage: vi.fn(() => {
          throw new Error('Canvas allocation failed');
        }),
      };
      const canvas = { width: 0, height: 0, context, getContext: vi.fn(() => context) };
      canvases.push(canvas);
      return canvas;
    });
    await expect(imageCanvas(file())).rejects.toThrow('解码失败：Canvas allocation failed');
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
    expect(decoded.close).toHaveBeenCalledOnce();
  });
});
