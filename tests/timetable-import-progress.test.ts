import { expect, it } from 'vitest';
import { createImportProgress } from '../src/features/timetable-import/import-progress';

it('keeps one course phase while local jobs reset and never regresses or reports complete', () => {
  const values: { stage: string; progress: number }[] = [];
  const progress = createImportProgress((value) => values.push(value));
  progress.phase('正在识别课程格 3/11', 0.3, 0.4, 3);
  for (const value of [0, 0.5, 1, 0, 0.5, 1, 0, 1])
    progress.worker({ stage: '正在离线识别课程文字…', progress: value });
  progress.worker({ stage: '正在准备本地识别资源…', progress: 0 });
  progress.finish();
  progress.phase('下一课程格', 0.4, 0.5, 3);
  expect(values.slice(0, -1).every((value) => value.stage === '正在识别课程格 3/11')).toBe(true);
  expect(values.map((value) => value.progress)).toEqual(
    [...values.map((value) => value.progress)].sort((a, b) => a - b),
  );
  expect(values.at(-1)?.progress).toBe(0.4);
  expect(Math.max(...values.map((value) => value.progress))).toBeLessThan(1);
});

it('ignores late worker messages after cancellation', () => {
  const controller = new AbortController();
  const values: number[] = [];
  const progress = createImportProgress((value) => values.push(value.progress), controller.signal);
  progress.phase('课程', 0, 0.5);
  controller.abort();
  progress.worker({ stage: '正在离线识别课程文字…', progress: 1 });
  progress.finish();
  expect(values).toEqual([0]);
});
