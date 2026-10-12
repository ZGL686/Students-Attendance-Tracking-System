import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 400, height: 866 } });

const reader = `
import { createEmptyDraft } from '/src/features/timetable-import/model.ts';
export async function readImages(files, options) {
  const state = window.__progressReader ??= { calls: [], active: 0, canceled: 0 };
  const call = { names: files.map(file => file.name), signal: options.signal };
  state.calls.push(call);
  state.active++;
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => options.signal?.removeEventListener('abort', abort);
      const abort = () => { cleanup(); state.canceled++; reject(new DOMException('已取消导入。', 'AbortError')); };
      call.progress = (progress, stage) => options.onProgress?.({ progress, stage });
      call.finish = () => { cleanup(); resolve(); };
      call.timeout = () => { cleanup(); const error = new Error('图片识别超时，请重选清晰课表后重试。'); error.name = 'TimeoutError'; reject(error); };
      options.signal?.addEventListener('abort', abort, { once: true });
      call.progress(0.04, '虚构识别开始');
      if (options.signal?.aborted) abort();
    });
    return {
      drafts: [{ ...createEmptyDraft(files[0].name), name: '虚构进度课程', teacher: '', room: '',
        day: '7', start: '9', end: '10', weeks: '1-16', layout: 'grid' }],
      catalog: [], sources: [{ index: 0, label: files[0].name }], warnings: [],
    };
  } finally { state.active--; }
}
`;

type ReaderCall = {
  progress: (value: number, stage: string) => void;
  finish: () => void;
  timeout: () => void;
};
type ReaderState = { calls: ReaderCall[]; active: number; canceled: number };
type Sample = { value: number; text: string };

test.beforeEach(async ({ page }) => {
  await page.route('**/src/features/timetable-import/readImages.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: reader }),
  );
  await page.goto('/phone-preview.html');
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
});

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('ludian-phone-simulator', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('snapshots').objectStore('snapshots').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
  });
}

async function choose(page: Page, name: string) {
  await page.getByLabel('选择课程表图片或文件', { exact: true }).setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from('mock-progress-input'),
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __progressReader?: ReaderState;
            }
          ).__progressReader?.active,
      ),
    )
    .toBe(1);
}

async function control(page: Page, action: 'finish' | 'timeout', index?: number) {
  await page.evaluate(
    ({ action, index }) => {
      const state = (window as unknown as { __progressReader: ReaderState }).__progressReader;
      state.calls[index ?? state.calls.length - 1][action]();
    },
    { action, index },
  );
}

test('local worker progress resets never lower the displayed batch progress or show 100% while recognition is pending', async ({
  page,
}, testInfo) => {
  await page.evaluate(() => {
    const samples: Sample[] = [];
    (window as unknown as { __progressSamples: Sample[] }).__progressSamples = samples;
    new MutationObserver(() => {
      const progress = document.querySelector<HTMLProgressElement>('.import-progress progress');
      const text = document.querySelector('.import-progress > span')?.textContent ?? '';
      if (progress) samples.push({ value: progress.value, text });
    }).observe(document.body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
  });
  const before = await snapshot(page);
  await choose(page, '虚构重复局部进度.png');
  for (const [index, value] of [0.25, 0, 1, 0, 0.55, 1, 0, 0.8].entries()) {
    const stage = `虚构局部步骤 ${index + 1}`;
    await page.evaluate(
      ({ value, stage }) => {
        const state = (window as unknown as { __progressReader: ReaderState }).__progressReader;
        state.calls[0].progress(value, stage);
      },
      { value, stage },
    );
    await expect(page.locator('.import-progress')).toContainText(stage);
    await expect(page.locator('.import-progress')).not.toContainText('100%');
  }
  const samples = await page.evaluate(
    () => (window as unknown as { __progressSamples: Sample[] }).__progressSamples,
  );
  expect(samples.length).toBeGreaterThan(4);
  expect(
    samples.every(
      (sample) => sample.value >= 0 && sample.value < 1 && !sample.text.includes('100%'),
    ),
  ).toBe(true);
  for (let index = 1; index < samples.length; index++)
    expect(samples[index].value).toBeGreaterThanOrEqual(samples[index - 1].value);
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.evaluate(
      () => (window as unknown as { __progressReader: ReaderState }).__progressReader.calls.length,
    ),
  ).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('phone-monotone-progress.png') });
  await control(page, 'finish');
  await expect(page.getByRole('dialog', { name: '导入课程', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已导入 1 门课程');
});

test('cancel stops the pending reader, preserves snapshots for five seconds, and ignores stale progress', async ({
  page,
}) => {
  const before = await snapshot(page);
  await choose(page, '虚构慢识别.png');
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByRole('button', { name: '取消导入', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __progressReader: ReaderState }).__progressReader.active,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __progressReader: ReaderState }).__progressReader.canceled,
    ),
  ).toBe(1);
  await expect(page.getByLabel('选择课程表图片或文件', { exact: true })).toBeEnabled();
  // Observe a full five-second window, rather than only checking immediately.
  await page.waitForTimeout(5_000);
  expect(await snapshot(page)).toEqual(before);
  await expect(dialog.locator('.import-summary')).toHaveCount(0);
  await choose(page, '虚构取消后重选.png');
  await page.evaluate(() => {
    const state = (window as unknown as { __progressReader: ReaderState }).__progressReader;
    state.calls[0].progress(1, '旧任务迟到消息');
  });
  await expect(dialog).not.toContainText('旧任务迟到消息');
  await control(page, 'finish');
  await expect(dialog).toHaveCount(0);
  expect(((await snapshot(page)) as unknown[]).length).toBe((before as unknown[]).length + 1);
});

test('a timeout shows no saved success and permits a fresh selection to save once', async ({
  page,
}) => {
  const before = await snapshot(page);
  await choose(page, '虚构超时.png');
  await control(page, 'timeout');
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('图片识别超时');
  await expect(page.getByLabel('选择课程表图片或文件', { exact: true })).toBeEnabled();
  await expect(dialog.locator('.import-summary')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await choose(page, '虚构超时后重选.png');
  await control(page, 'finish');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已导入 1 门课程');
  expect(((await snapshot(page)) as unknown[]).length).toBe((before as unknown[]).length + 1);
});

test('recognition completion followed by storage abort never reports imported success', async ({
  page,
}) => {
  const before = await snapshot(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = add.call(this, value, key);
      if (this.name === 'snapshots' && this.transaction.db.name === 'ludian-phone-simulator')
        this.transaction.abort();
      return request;
    };
  });
  await choose(page, '虚构保存失败.png');
  await control(page, 'finish');
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('导入未保存');
  await expect(dialog.locator('.import-summary')).toHaveCount(0);
  await expect(dialog).not.toContainText('已导入 1 门课程');
  expect(await snapshot(page)).toEqual(before);
});
