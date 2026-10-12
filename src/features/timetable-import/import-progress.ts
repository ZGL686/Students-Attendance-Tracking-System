import type { ImportProgress } from './model';

/** Local OCR jobs can restart at zero; the batch progress must not. */
export function createImportProgress(
  report?: (value: ImportProgress) => void,
  signal?: AbortSignal,
) {
  let value = 0;
  let stage = '正在准备识别…';
  let start = 0,
    end = 0.03,
    jobs = 1,
    completed = 0,
    last = 0;
  const emit = (next: number) => {
    if (signal?.aborted) return;
    value = Math.max(value, Math.min(0.97, Number.isFinite(next) ? next : value));
    report?.({ stage, progress: value });
  };
  return {
    phase(label: string, from: number, to: number, maximumJobs = 1) {
      stage = label;
      start = from;
      end = to;
      jobs = Math.max(1, maximumJobs);
      completed = 0;
      last = 0;
      emit(start);
    },
    worker(next: ImportProgress) {
      if (!next.stage.includes('离线识别课程文字')) {
        emit(value);
        return;
      }
      const fraction = Math.min(1, Math.max(0, next.progress));
      if (last >= 0.99 && fraction < last) completed++;
      last = fraction;
      emit(start + (end - start) * Math.min(0.95, (completed + fraction) / jobs));
    },
    finish() {
      emit(end);
    },
  };
}
