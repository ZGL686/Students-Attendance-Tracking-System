import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManagedOcrWorker } from '../src/features/timetable-import/managed-ocr-worker';
import type {
  ManagedOcrOptions,
  OcrTextResult,
} from '../src/features/timetable-import/managed-ocr-worker';

type Packet = { workerId: string; jobId: string; action: string; payload: unknown };
type ReplyStatus = 'resolve' | 'reject' | 'progress';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static onPost: ((worker: FakeWorker, packet: Packet) => void) | undefined;
  readonly packets: Packet[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  terminate = vi.fn();
  constructor(readonly path: string) {
    FakeWorker.instances.push(this);
  }
  postMessage(packet: Packet) {
    this.packets.push(packet);
    FakeWorker.onPost?.(this, packet);
  }
  reply(packet: Packet, status: ReplyStatus, data?: unknown) {
    this.onmessage?.({
      data: { workerId: packet.workerId, jobId: packet.jobId, action: packet.action, status, data },
    } as MessageEvent<unknown>);
  }
}

const options = (extra: Partial<ManagedOcrOptions> = {}): ManagedOcrOptions => ({
  workerPath: '/offline/ocr/worker.min.js',
  corePath: '/offline/ocr/core/',
  langPath: '/offline/ocr/lang',
  ...extra,
});
const recognized: OcrTextResult = { text: '虚构课程', blocks: null, confidence: 96 };
const canvas = (toBlob: (callback: BlobCallback, type?: string) => void) =>
  ({ toBlob }) as unknown as HTMLCanvasElement;
const encodedCanvas = () =>
  canvas((callback) =>
    callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })),
  );
const completeJobs = () => {
  FakeWorker.onPost = (worker, packet) =>
    worker.reply(packet, 'resolve', packet.action === 'recognize' ? recognized : undefined);
};
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

describe('managed raw OCR worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    FakeWorker.onPost = undefined;
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes with the bundled protocol and recognizes PNG bytes and rectangle', async () => {
    const progress = vi.fn();
    FakeWorker.onPost = (worker, packet) => {
      worker.reply(packet, 'progress', {
        status: packet.action === 'load' ? 'initializing tesseract' : 'recognizing text',
        progress: 0.4,
      });
      worker.reply(packet, 'resolve', packet.action === 'recognize' ? recognized : undefined);
    };
    const managed = await createManagedOcrWorker('chi_sim+eng', options({ onProgress: progress }));
    const worker = FakeWorker.instances[0];
    expect(worker.path).toBe('/offline/ocr/worker.min.js');
    expect(worker.packets.map((packet) => packet.action)).toEqual([
      'load',
      'loadLanguage',
      'initialize',
    ]);
    expect(worker.packets[0].payload).toEqual({
      options: { lstmOnly: true, corePath: '/offline/ocr/core/' },
    });
    expect(worker.packets[1].payload).toEqual({
      langs: ['chi_sim', 'eng'],
      options: { langPath: '/offline/ocr/lang', gzip: true, lstmOnly: true, cacheMethod: 'none' },
    });
    expect(worker.packets[2].payload).toEqual({ langs: 'chi_sim+eng', oem: 1, config: {} });
    const rectangle = { left: 10, top: 20, width: 100, height: 80 };
    await expect(managed.recognize(encodedCanvas(), rectangle)).resolves.toEqual(recognized);
    expect(worker.packets.at(-1)?.payload).toEqual({
      image: new Uint8Array([137, 80, 78, 71]),
      options: { rectangle },
      output: { text: true, blocks: true },
    });
    expect(progress).toHaveBeenCalledWith({ status: 'initializing tesseract', progress: 0.4 });
    expect(progress).toHaveBeenCalledWith({ status: 'recognizing text', progress: 0.4 });
    expect(vi.getTimerCount()).toBe(0);
    await managed.terminate();
    await managed.terminate();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(['load', 'loadLanguage', 'initialize'])(
    'rejects failed %s initialization immediately and terminates',
    async (action) => {
      FakeWorker.onPost = (worker, packet) =>
        worker.reply(
          packet,
          packet.action === action ? 'reject' : 'resolve',
          packet.action === action ? '模型初始化失败' : undefined,
        );
      await expect(createManagedOcrWorker('chi_sim', options())).rejects.toThrow('模型初始化失败');
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('cancels initialization before any response and ignores late progress', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    const pending = createManagedOcrWorker(
      'chi_sim',
      options({ signal: controller.signal, onProgress: progress }),
    );
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    const worker = FakeWorker.instances[0];
    const handler = worker.onmessage!;
    const packet = worker.packets[0];
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await rejected;
    handler({
      data: {
        ...packet,
        status: 'progress',
        data: { status: 'loading language traineddata', progress: 0.9 },
      },
    } as MessageEvent<unknown>);
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create a worker for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createManagedOcrWorker('chi_sim', options({ signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['load', 'loadLanguage', 'initialize'])(
    'terminates a hung %s stage at 45 seconds',
    async (action) => {
      FakeWorker.onPost = (worker, packet) => {
        if (packet.action !== action) worker.reply(packet, 'resolve');
      };
      const pending = createManagedOcrWorker('chi_sim', options());
      const rejected = expect(pending).rejects.toThrow('45 秒');
      await flush();
      await vi.advanceTimersByTimeAsync(45_000);
      await rejected;
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds a toBlob callback that never finishes and does not send a late image', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    let callback!: BlobCallback;
    const pending = managed.recognize(
      canvas((value) => {
        callback = value;
      }),
    );
    const rejected = expect(pending).rejects.toThrow('45 秒');
    await flush();
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    callback(new Blob([new Uint8Array([1, 2, 3])]));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker.packets.filter((packet) => packet.action === 'recognize')).toHaveLength(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a Blob arrayBuffer that never finishes', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    const blob = { arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) } as Blob;
    const pending = managed.recognize(canvas((callback) => callback(blob)));
    const rejected = expect(pending).rejects.toThrow('45 秒');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects encoding failure and closes the raw worker', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    await expect(managed.recognize(canvas((callback) => callback(null)))).rejects.toThrow(
      '无法读取图片像素',
    );
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an asynchronous Blob read failure and closes the worker', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    const blob = {
      arrayBuffer: () => {
        throw new Error('图片读取失败');
      },
    } as unknown as Blob;
    const pending = managed.recognize(
      canvas((callback) => {
        queueMicrotask(() => callback(blob));
      }),
    );
    await expect(pending).rejects.toThrow('图片读取失败');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates an already posted recognition at 45 seconds and ignores its late reply', async () => {
    completeJobs();
    const progress = vi.fn();
    const managed = await createManagedOcrWorker('chi_sim', options({ onProgress: progress }));
    FakeWorker.onPost = undefined;
    const pending = managed.recognize(encodedCanvas());
    const rejected = expect(pending).rejects.toThrow('本次图片识别超过 45 秒');
    await flush();
    const worker = FakeWorker.instances[0];
    const packet = worker.packets.at(-1)!;
    const handler = worker.onmessage!;
    expect(packet.action).toBe('recognize');
    worker.reply(packet, 'progress', { status: 'recognizing text', progress: 0.6 });
    expect(progress).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    handler({
      data: { ...packet, status: 'progress', data: { status: 'recognizing text', progress: 1 } },
    } as MessageEvent<unknown>);
    handler({ data: { ...packet, status: 'resolve', data: recognized } } as MessageEvent<unknown>);
    expect(progress).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(managed.setParameters({ preserve_interword_spaces: '1' })).rejects.toThrow(
      '本次图片识别超过 45 秒',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an already posted recognition immediately and suppresses its later progress', async () => {
    completeJobs();
    const controller = new AbortController();
    const progress = vi.fn();
    const managed = await createManagedOcrWorker(
      'chi_sim',
      options({ signal: controller.signal, onProgress: progress }),
    );
    FakeWorker.onPost = undefined;
    const pending = managed.recognize(encodedCanvas());
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    const worker = FakeWorker.instances[0];
    const packet = worker.packets.at(-1)!;
    const handler = worker.onmessage!;
    expect(packet.action).toBe('recognize');
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
    await rejected;
    handler({
      data: { ...packet, status: 'progress', data: { status: 'recognizing text', progress: 1 } },
    } as MessageEvent<unknown>);
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start PNG encoding if cancellation arrived before the queued preparation', async () => {
    completeJobs();
    const controller = new AbortController();
    const managed = await createManagedOcrWorker('chi_sim', options({ signal: controller.signal }));
    const toBlob = vi.fn();
    const pending = managed.recognize(canvas(toBlob));
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    await flush();
    expect(toBlob).not.toHaveBeenCalled();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a hung parameter operation at its deadline', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    FakeWorker.onPost = undefined;
    const pending = managed.setParameters({ preserve_interword_spaces: '1' });
    const rejected = expect(pending).rejects.toThrow('识别引擎超过 45 秒');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'messageerror'])(
    'rejects every pending operation on a raw worker %s',
    async (kind) => {
      completeJobs();
      const managed = await createManagedOcrWorker('chi_sim', options());
      FakeWorker.onPost = undefined;
      const first = managed.setParameters({ preserve_interword_spaces: '1' });
      const second = managed.recognize(canvas(() => {}));
      const failures = [expect(first).rejects.toThrow(), expect(second).rejects.toThrow()];
      await flush();
      const worker = FakeWorker.instances[0];
      if (kind === 'error')
        worker.onerror?.({
          message: 'WASM 进程失败',
          preventDefault: vi.fn(),
        } as unknown as ErrorEvent);
      else worker.onmessageerror?.({} as MessageEvent<unknown>);
      await Promise.all(failures);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects all pending jobs on an engine reject and ignores late callbacks', async () => {
    completeJobs();
    const progress = vi.fn();
    const managed = await createManagedOcrWorker('chi_sim', options({ onProgress: progress }));
    FakeWorker.onPost = undefined;
    const first = managed.setParameters({ preserve_interword_spaces: '1' });
    const second = managed.recognize(canvas(() => {}));
    const failures = [
      expect(first).rejects.toThrow('参数失败'),
      expect(second).rejects.toThrow('参数失败'),
    ];
    await flush();
    const worker = FakeWorker.instances[0];
    const handler = worker.onmessage!;
    const packet = worker.packets.at(-1)!;
    worker.reply(packet, 'reject', '参数失败');
    await Promise.all(failures);
    handler({
      data: { ...packet, status: 'progress', data: { status: 'recognizing text', progress: 1 } },
    } as MessageEvent<unknown>);
    expect(progress).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('loads only new language files on reinitialize and uses string language initialization', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    await managed.setParameters({ preserve_interword_spaces: '1' });
    await managed.reinitialize('eng');
    await managed.reinitialize('chi_sim+eng');
    const worker = FakeWorker.instances[0];
    const languageJobs = worker.packets.filter((packet) => packet.action === 'loadLanguage');
    expect(languageJobs.map((packet) => (packet.payload as { langs: string[] }).langs)).toEqual([
      ['chi_sim'],
      ['eng'],
    ]);
    expect(worker.packets.at(-1)?.payload).toEqual({ langs: 'chi_sim+eng', oem: 1, config: {} });
    await managed.terminate();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('encodes a mutable canvas for every recognition by default', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options());
    let content = 1;
    const toBlob = vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([content])])),
    );
    const image = canvas(toBlob);
    await managed.recognize(image);
    content = 2;
    await managed.recognize(image);
    expect(toBlob).toHaveBeenCalledTimes(2);
    const recognizedPackets = FakeWorker.instances[0].packets.filter(
      (packet) => packet.action === 'recognize',
    );
    expect(
      recognizedPackets.map((packet) => (packet.payload as { image: Uint8Array }).image),
    ).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
    await managed.terminate();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('encodes the same immutable canvas only once when caching is explicitly enabled', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options({ cacheImages: true }));
    const toBlob = vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array([1, 2, 3])])),
    );
    const image = canvas(toBlob);
    await managed.recognize(image, { left: 0, top: 0, width: 50, height: 50 });
    await managed.recognize(image, { left: 50, top: 0, width: 50, height: 50 });
    expect(toBlob).toHaveBeenCalledOnce();
    const recognizedPackets = FakeWorker.instances[0].packets.filter(
      (packet) => packet.action === 'recognize',
    );
    expect(recognizedPackets).toHaveLength(2);
    expect(
      recognizedPackets.map((packet) => (packet.payload as { image: Uint8Array }).image),
    ).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])]);
    await managed.terminate();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reuse pixels between different canvases with the same dimensions', async () => {
    completeJobs();
    const managed = await createManagedOcrWorker('chi_sim', options({ cacheImages: true }));
    const first = Object.assign(
      canvas((callback) => callback(new Blob([new Uint8Array([1])]))),
      { width: 100, height: 100 },
    );
    const second = Object.assign(
      canvas((callback) => callback(new Blob([new Uint8Array([2])]))),
      { width: 100, height: 100 },
    );
    await managed.recognize(first);
    await managed.recognize(second);
    const recognizedPackets = FakeWorker.instances[0].packets.filter(
      (packet) => packet.action === 'recognize',
    );
    expect(
      recognizedPackets.map((packet) => (packet.payload as { image: Uint8Array }).image),
    ).toEqual([new Uint8Array([1]), new Uint8Array([2])]);
    await managed.terminate();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores cached image completion after cancellation and refuses further recognition', async () => {
    completeJobs();
    const controller = new AbortController();
    const managed = await createManagedOcrWorker(
      'chi_sim',
      options({ signal: controller.signal, cacheImages: true }),
    );
    let callback!: BlobCallback;
    const toBlob = vi.fn((value: BlobCallback) => {
      callback = value;
    });
    const image = canvas(toBlob);
    const pending = managed.recognize(image);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    controller.abort();
    await rejected;
    callback(new Blob([new Uint8Array([1])]));
    await flush();
    await expect(managed.recognize(image)).rejects.toMatchObject({ name: 'AbortError' });
    const worker = FakeWorker.instances[0];
    expect(worker.packets.filter((packet) => packet.action === 'recognize')).toHaveLength(0);
    expect(toBlob).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
