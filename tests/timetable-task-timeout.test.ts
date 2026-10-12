import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTaskTimeout } from '../src/features/timetable-import/task-timeout';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('OCR task deadline and cancellation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a successful result and removes its deadline and abort listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const cancel = vi.fn();
    const task = deferred<string>();
    const result = withTaskTimeout(task.promise, controller.signal, 100, cancel, '识别超时');
    task.resolve('课程');
    await expect(result).resolves.toBe('课程');
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('preserves a worker failure and releases the timer and listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const cancel = vi.fn();
    const task = deferred<string>();
    const error = new Error('无法加载识别模型');
    const result = withTaskTimeout(task.promise, controller.signal, 100, cancel, '识别超时');
    const rejected = expect(result).rejects.toBe(error);
    task.reject(error);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledOnce();
    controller.abort();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('rejects at the deadline and terminates once, without waiting for cleanup', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const result = withTaskTimeout(
      new Promise<string>(() => {}),
      controller.signal,
      100,
      cancel,
      '本次识别超时',
    );
    const rejected = expect(result).rejects.toThrow('本次识别超时');
    await vi.advanceTimersByTimeAsync(99);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('aborts immediately and cannot terminate a second time at the old deadline', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const result = withTaskTimeout(
      new Promise<string>(() => {}),
      controller.signal,
      100,
      cancel,
      '识别超时',
    );
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await rejected;
    await vi.advanceTimersByTimeAsync(100);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('consumes a rejected pending task when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const cancel = vi.fn();
    const result = withTaskTimeout(
      Promise.reject(new Error('迟到的 Worker 错误')),
      controller.signal,
      100,
      cancel,
      '识别超时',
    );
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await Promise.resolve();
  });

  it('does not deliver late completion to its consumer after timing out', async () => {
    const task = deferred<string>();
    const cancel = vi.fn();
    const delivered = vi.fn();
    const result = withTaskTimeout(task.promise, undefined, 100, cancel, '识别超时');
    const observed = result.then(delivered, () => {});
    await vi.advanceTimersByTimeAsync(100);
    await observed;
    task.resolve('迟到的课程结果');
    await Promise.resolve();
    expect(delivered).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('consumes a worker rejection that arrives after a timeout', async () => {
    const task = deferred<string>();
    const cancel = vi.fn();
    const result = withTaskTimeout(task.promise, undefined, 100, cancel, '识别超时');
    const rejected = expect(result).rejects.toThrow('识别超时');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    task.reject(new Error('Worker 已终止'));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates immediately when the worker itself reports AbortError', async () => {
    const cancel = vi.fn();
    const error = new DOMException('Worker 已取消', 'AbortError');
    const result = withTaskTimeout(Promise.reject(error), undefined, 100, cancel, '识别超时');
    await expect(result).rejects.toBe(error);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timeout error if termination throws', async () => {
    const cancel = vi.fn(() => {
      throw new Error('终止失败');
    });
    const result = withTaskTimeout(
      new Promise<string>(() => {}),
      undefined,
      100,
      cancel,
      '识别超时',
    );
    const rejected = expect(result).rejects.toThrow('识别超时');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes an asynchronous termination failure without delaying the timeout', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('异步终止失败');
    });
    const result = withTaskTimeout(
      new Promise<string>(() => {}),
      undefined,
      100,
      cancel,
      '识别超时',
    );
    const rejected = expect(result).rejects.toThrow('识别超时');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
