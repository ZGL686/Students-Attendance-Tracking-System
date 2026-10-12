import type { Page, WorkerParams } from 'tesseract.js';
import { withTaskTimeout } from './task-timeout';

export type OcrTextResult = Pick<Page, 'text' | 'blocks' | 'confidence'>;
export type OcrRectangle = { left: number; top: number; width: number; height: number };
export type ManagedOcrWorker = {
  recognize: (image: HTMLCanvasElement, rectangle?: OcrRectangle) => Promise<OcrTextResult>;
  setParameters: (parameters: Partial<WorkerParams>) => Promise<void>;
  reinitialize: (languages: string) => Promise<void>;
  terminate: () => Promise<void>;
};
export type ManagedOcrOptions = {
  workerPath: string;
  corePath: string;
  langPath: string;
  signal?: AbortSignal;
  onProgress?: (value: { status: string; progress: number }) => void;
  /** Only enable when every canvas stays immutable for this worker's lifetime. */
  cacheImages?: boolean;
};

type Job = {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
type WorkerPacket = {
  workerId?: unknown;
  jobId?: unknown;
  action?: unknown;
  status?: unknown;
  data?: unknown;
};

const deadline = 45_000;
let workerCounter = 0;

function failure(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string')
    return new Error(value.message);
  return new Error('本地文字识别进程发生错误。');
}

const aborted = () => new DOMException('已取消导入。', 'AbortError');

function languageList(languages: string): string[] {
  const values = [
    ...new Set(
      languages
        .split('+')
        .map((language) => language.trim())
        .filter(Boolean),
    ),
  ];
  if (!values.length) throw new Error('请选择本地文字识别语言。');
  return values;
}

/** Encode inside the operation deadline, including a missing toBlob callback. */
function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('无法读取图片像素，请重新选择图片。'));
          return;
        }
        // The browser runs this callback later, outside the surrounding toBlob try/catch.
        void Promise.resolve()
          .then(() => blob.arrayBuffer())
          .then((buffer) => resolve(new Uint8Array(buffer)), reject);
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

/** Own the raw Tesseract 7 worker before its first initialization message is sent. */
export async function createManagedOcrWorker(
  languages: string,
  options: ManagedOcrOptions,
): Promise<ManagedOcrWorker> {
  if (options.signal?.aborted) throw aborted();
  const initialLanguages = languageList(languages);
  const workerId = `ludian-ocr-${workerCounter++}`;
  const raw = new Worker(options.workerPath);
  const jobs = new Map<string, Job>();
  const loadedLanguages = new Set<string>();
  let jobCounter = 0;
  let closed = false;
  let closedError: Error = aborted();
  let imageBytes = new WeakMap<HTMLCanvasElement, Promise<Uint8Array>>();
  const shutdown = (reason: unknown) => {
    if (closed) return;
    closed = true;
    closedError = failure(reason);
    imageBytes = new WeakMap();
    options.signal?.removeEventListener('abort', onAbort);
    raw.onmessage = null;
    raw.onerror = null;
    raw.onmessageerror = null;
    try {
      raw.terminate();
    } catch {
      // A failing browser cleanup must not leave callers waiting for a response.
    }
    for (const job of jobs.values()) job.reject(closedError);
    jobs.clear();
  };
  const onAbort = () => shutdown(aborted());
  const assertOpen = () => {
    if (options.signal?.aborted) shutdown(aborted());
    if (closed) throw closedError;
  };
  const encodeImage = (image: HTMLCanvasElement) => {
    if (!options.cacheImages) return pngBytes(image);
    const cached = imageBytes.get(image);
    if (cached) return cached;
    const pending = pngBytes(image);
    imageBytes.set(image, pending);
    return pending;
  };

  const runJob = <T>(action: string, payload: unknown | (() => Promise<unknown>)): Promise<T> => {
    assertOpen();
    const jobId = `${workerId}-job-${jobCounter++}`;
    const pending = new Promise<T>((resolve, reject) => {
      jobs.set(jobId, { action, resolve: (value) => resolve(value as T), reject });
    });
    const message =
      action === 'recognize'
        ? '本次图片识别超过 45 秒，请缩小图片或重新选择后再试。'
        : '本地文字识别引擎超过 45 秒未响应，请重新尝试导入。';
    const bounded = withTaskTimeout(
      pending,
      options.signal,
      deadline,
      () => shutdown(new Error(message)),
      message,
    );
    // Preparing the PNG is part of this job, so cancellation can reject it before encoding ends.
    void Promise.resolve()
      .then(() => {
        if (closed || !jobs.has(jobId)) return undefined;
        return typeof payload === 'function' ? payload() : payload;
      })
      .then((value) => {
        if (closed || !jobs.has(jobId)) return;
        raw.postMessage({ workerId, jobId, action, payload: value });
      })
      .catch((error: unknown) => shutdown(error));
    return bounded.finally(() => jobs.delete(jobId));
  };

  raw.onmessage = (event: MessageEvent<unknown>) => {
    if (closed || !event.data || typeof event.data !== 'object') return;
    const packet = event.data as WorkerPacket;
    if (packet.workerId !== workerId || typeof packet.jobId !== 'string') return;
    const job = jobs.get(packet.jobId);
    if (!job || packet.action !== job.action) return;
    if (packet.status === 'reject') {
      shutdown(packet.data);
    } else if (packet.status === 'resolve') {
      jobs.delete(packet.jobId);
      job.resolve(packet.data);
    } else if (packet.status === 'progress') {
      const data = packet.data;
      if (
        data &&
        typeof data === 'object' &&
        'status' in data &&
        'progress' in data &&
        typeof data.status === 'string' &&
        typeof data.progress === 'number' &&
        Number.isFinite(data.progress)
      ) {
        try {
          options.onProgress?.({ status: data.status, progress: data.progress });
        } catch (error) {
          shutdown(error);
        }
      }
    }
  };
  raw.onerror = (event) => {
    event.preventDefault();
    shutdown(new Error(event.message || '本地文字识别进程无法运行。'));
  };
  raw.onmessageerror = () => shutdown(new Error('本地文字识别进程的消息无法读取。'));
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const loadLanguages = async (values: string[]) => {
    const missing = values.filter((language) => !loadedLanguages.has(language));
    if (!missing.length) return;
    await runJob<void>('loadLanguage', {
      langs: missing,
      options: { langPath: options.langPath, gzip: true, lstmOnly: true, cacheMethod: 'none' },
    });
    for (const language of missing) loadedLanguages.add(language);
  };
  const initialize = async (values: string[]) => {
    await loadLanguages(values);
    // initialize's string form avoids the worker-side array conversion branch.
    await runJob<void>('initialize', { langs: values.join('+'), oem: 1, config: {} });
  };
  try {
    assertOpen();
    await runJob<void>('load', { options: { lstmOnly: true, corePath: options.corePath } });
    await initialize(initialLanguages);
    return {
      recognize: async (image, rectangle) =>
        runJob<OcrTextResult>('recognize', async () => ({
          image: await encodeImage(image),
          options: rectangle ? { rectangle } : {},
          output: { text: true, blocks: true },
        })),
      setParameters: async (params) => {
        await runJob<void>('setParameters', { params });
      },
      reinitialize: async (nextLanguages) => {
        await initialize(languageList(nextLanguages));
      },
      terminate: async () => {
        shutdown(aborted());
      },
    };
  } catch (error) {
    shutdown(error);
    throw error;
  }
}
