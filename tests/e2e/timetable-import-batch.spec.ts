import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { AppData } from '../../src/model';

// These tests isolate the UI/transaction boundary. Real pixel OCR is exercised
// separately by timetable-colored-ocr.spec.ts.
const imageReader = `
import { createEmptyDraft, checkAborted } from '/src/features/timetable-import/model.ts';
export async function readImages(files, options) {
  const mock = window.__batchReader ??= { calls: [], active: 0, aborted: 0 };
  const names = files.map(file => file.name);
  mock.calls.push({ names, catalog: (options.catalog ?? []).map(entry => entry.name) });
  mock.active++;
  try {
    checkAborted(options.signal);
    options.onProgress?.({ stage: '虚构批次识别', progress: 0.5 });
    if (names.some(name => name.includes('延迟'))) {
      await new Promise((resolve, reject) => {
        const done = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(new DOMException('已取消导入。', 'AbortError')); };
        const cleanup = () => {
          window.removeEventListener('finish-batch-reader', done);
          options.signal?.removeEventListener('abort', abort);
        };
        window.addEventListener('finish-batch-reader', done);
        options.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    checkAborted(options.signal);
    if (names.some(name => name.includes('损坏'))) throw new Error('虚构批次识别失败');
    const catalog = [...(options.catalog ?? [])];
    if (names.some(name => name.includes('目录')) && !catalog.length)
      catalog.push({ code: 'FAKE-001', name: '虚构批次设计', teacher: '虚构目录教师',
        source: '虚构目录.png', fieldConfidence: { name: 98, teacher: 98 } });
    const drafts = [];
    for (const name of names) {
      if (name.includes('安排')) drafts.push({ ...createEmptyDraft(name),
        name: '虚构批次设计', day: '7', start: '9', end: '10', weeks: '', layout: 'grid',
        teacher: catalog.find(entry => entry.name === '虚构批次设计')?.teacher ?? '',
        room: '虚构教室', fieldConfidence: { name: 98, day: 100, periods: 100, room: 98 } });
      if (name.includes('低置信')) drafts.push({ ...createEmptyDraft(name),
        name: '虚构不可靠课程', day: '6', start: '9', end: '10', weeks: '', layout: 'grid',
        fieldConfidence: { name: 60, day: 100, periods: 100 } });
    }
    return { drafts, catalog, sources: files.map((file, index) => ({ index, label: file.name })), warnings: [] };
  } catch (error) {
    if (error.name === 'AbortError') mock.aborted++;
    throw error;
  } finally { mock.active--; }
}
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/local-seed.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ name: '虚构批次验收班', students: [] }),
    }),
  );
  await page.route('**/src/features/timetable-import/readImages.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: imageReader }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
});

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('guilu-attendance', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<{ revision: number; payload: string }>((resolve, reject) => {
      const request = database
        .transaction('snapshots')
        .objectStore('snapshots')
        .openCursor(null, 'prev');
      request.onsuccess = () => resolve(request.result!.value);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return { revision: stored.revision, data: JSON.parse(stored.payload) as AppData };
  });
}

async function openImport(page: Page) {
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  return page.getByRole('dialog', { name: '导入课程', exact: true });
}

async function chooseImages(page: Page, names: string[]) {
  await page.getByLabel('选择课程表图片或文件', { exact: true }).setInputFiles(
    names.map((name) => ({
      name,
      mimeType: 'image/png',
      buffer: Buffer.from('synthetic-reader-input'),
    })),
  );
}

async function readerState(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __batchReader: {
            calls: { names: string[]; catalog: string[] }[];
            active: number;
            aborted: number;
          };
        }
      ).__batchReader,
  );
}

for (const names of [
  ['虚构目录.png', '虚构安排.png'],
  ['虚构安排.png', '虚构目录.png'],
]) {
  test(`one multi-image batch saves once regardless of selection order: ${names[0]}`, async ({
    page,
  }) => {
    const before = await snapshot(page);
    const dialog = await openImport(page);
    await expect(page.getByLabel('选择课程表图片或文件', { exact: true })).toHaveAttribute(
      'multiple',
      '',
    );
    await chooseImages(page, names);
    await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程');
    const after = await snapshot(page);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.data.workspaces[0].courses.slice(0, -1)).toEqual(
      before.data.workspaces[0].courses,
    );
    expect(after.data.workspaces[0].courses.at(-1)).toMatchObject({
      name: '虚构批次设计',
      teacher: '虚构目录教师',
      day: 7,
      start: 9,
      end: 10,
      weeks: Array.from({ length: 20 }, (_, index) => index + 1),
    });
    expect((await readerState(page)).calls).toEqual([{ names, catalog: [] }]);
    await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0);
  });
}

test('a catalog alone never writes and remains available to a supplemental timetable in the same dialog', async ({
  page,
}) => {
  const before = await snapshot(page);
  const dialog = await openImport(page);
  await chooseImages(page, ['虚构目录.png']);
  await expect(dialog.getByRole('region', { name: '已识别的课程目录', exact: true })).toContainText(
    '虚构批次设计',
  );
  await expect(dialog).toContainText('请继续选择课表图片');
  expect(await snapshot(page)).toEqual(before);
  await expect(dialog.locator('.quick-course-entry')).toHaveCount(0);
  await chooseImages(page, ['虚构安排.png']);
  await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程');
  await expect(dialog.getByRole('region', { name: '已识别的课程目录', exact: true })).toHaveCount(
    0,
  );
  const after = await snapshot(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.data.workspaces[0].courses.at(-1)?.teacher).toBe('虚构目录教师');
  expect((await readerState(page)).calls).toEqual([
    { names: ['虚构目录.png'], catalog: [] },
    { names: ['虚构安排.png'], catalog: ['虚构批次设计'] },
  ]);
});

test('closing a catalog-only dialog releases its temporary references', async ({ page }) => {
  const before = await snapshot(page);
  let dialog = await openImport(page);
  await chooseImages(page, ['虚构目录.png']);
  await expect(dialog).toContainText('课程参考资料');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  dialog = await openImport(page);
  await chooseImages(page, ['虚构安排.png']);
  await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程');
  expect((await readerState(page)).calls.at(-1)?.catalog).toEqual([]);
  expect((await snapshot(page)).data.workspaces[0].courses.at(-1)?.teacher).toBe('');
});

test('a failed or canceled image batch never partially saves courses or catalog references', async ({
  page,
}) => {
  const before = await snapshot(page);
  const dialog = await openImport(page);
  await chooseImages(page, ['虚构目录.png', '虚构安排.png', '虚构损坏.png']);
  await expect(dialog.getByRole('alert')).toContainText('虚构批次识别失败');
  expect(await snapshot(page)).toEqual(before);
  await chooseImages(page, ['虚构目录.png', '虚构安排.png', '虚构延迟.png']);
  await expect.poll(async () => (await readerState(page)).active).toBe(1);
  await dialog.getByRole('button', { name: '取消导入', exact: true }).click();
  await expect.poll(async () => (await readerState(page)).active).toBe(0);
  expect((await readerState(page)).aborted).toBe(1);
  expect(await snapshot(page)).toEqual(before);
  await expect(dialog.locator('.import-summary')).toHaveCount(0);
  await chooseImages(page, ['虚构安排.png']);
  await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程');
  expect((await readerState(page)).calls.at(-1)?.catalog).toEqual([]);
});

test('a partial batch shows low-confidence skip reasons and infers weeks only for the saved arrangement', async ({
  page,
}) => {
  const before = await snapshot(page);
  const dialog = await openImport(page);
  await chooseImages(page, ['虚构安排.png', '虚构低置信.png']);
  await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程');
  await expect(dialog.locator('.import-skipped')).toContainText('虚构不可靠课程');
  await expect(dialog.locator('.import-skipped')).toContainText('置信度');
  const after = await snapshot(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.data.workspaces[0].courses).toHaveLength(
    before.data.workspaces[0].courses.length + 1,
  );
  expect(after.data.workspaces[0].courses.at(-1)?.name).toBe('虚构批次设计');
});
