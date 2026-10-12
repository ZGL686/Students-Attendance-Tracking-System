/** Bound a worker operation and release its timer/listener on every terminal path. */
export async function withTaskTimeout<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
  milliseconds: number,
  cancel: () => void,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let listening = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (listening) {
        signal?.removeEventListener('abort', onAbort);
        listening = false;
      }
    };
    const stop = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        // Termination may be asynchronous. Observe failures without delaying rejection.
        void Promise.resolve(cancel()).catch(() => {});
      } catch {
        // Keep the timeout/cancellation error even if worker cleanup fails synchronously.
      }
      reject(error);
    };
    const onAbort = () => stop(new DOMException('已取消导入。', 'AbortError'));
    // Attach both handlers before the pre-aborted check: a late worker rejection is consumed.
    void pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        if (
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          error.name === 'AbortError'
        ) {
          stop(error);
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      },
    );
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (signal) {
      listening = true;
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (settled) return;
    timer = setTimeout(() => stop(new Error(message)), milliseconds);
  });
}
