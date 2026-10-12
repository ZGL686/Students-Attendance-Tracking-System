import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';

const allowedHosts = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  'tauri.localhost',
  'asset.localhost',
  'ipc.localhost',
]);

export async function monitorNativeRequests(context) {
  const local = new Set();
  const external = new Set();
  function permitted(raw) {
    const url = new URL(raw);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
    const native = ['tauri:', 'asset:', 'ipc:'].includes(url.protocol);
    return (
      (native || ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) &&
      allowedHosts.has(url.hostname)
    );
  }
  function record(raw) {
    const url = new URL(raw);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    const list = permitted(raw) ? local : external;
    list.add(`${url.origin}${url.pathname}`);
  }
  context.on('request', (request) => record(request.url()));
  // BrowserContext routing also covers OCR worker requests. It does not intercept
  // the Node-side CDP connection used to drive the isolated native WebView.
  await context.route('**/*', async (route) => {
    record(route.request().url());
    if (permitted(route.request().url())) await route.continue();
    else await route.abort('blockedbyclient');
  });
  return { local, external };
}

export function assertNativeOffline(network, requireOcr = false) {
  assert.deepEqual([...network.external], [], 'Native app attempted an external network request');
  const resources = [...network.local].filter((url) => url.includes('/offline/ocr/'));
  if (requireOcr) {
    assert(
      resources.some((url) => url.endsWith('/worker.min.js')),
      'Bundled OCR worker was not requested',
    );
    assert(
      resources.some((url) => url.includes('/core/')),
      'Bundled OCR core was not requested',
    );
    for (const language of ['chi_sim', 'eng'])
      assert(
        resources.some((url) => url.includes(`/lang/${language}.traineddata`)),
        `Fresh profile did not load the bundled ${language} language data`,
      );
  }
  return resources;
}

async function syntheticTimetable(page) {
  const base64 = await page.evaluate(async () => {
    await document.fonts.load('36px "Microsoft YaHei"');
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 550;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic timetable canvas could not be created');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.font = '36px "Microsoft YaHei", sans-serif';
    context.fillText('星期一', 150, 70);
    context.fillText('星期二', 480, 70);
    context.font = '28px "Microsoft YaHei", sans-serif';
    context.fillText('桌面数字设计', 125, 170);
    context.fillText('教师：虚构教师', 125, 215);
    context.fillText('教室：桌面测试室', 125, 260);
    context.fillText('1-16周', 125, 305);
    context.fillText('第1-2节', 125, 350);
    context.fillText('1', 20, 170);
    context.fillText('2', 20, 350);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

async function showImportedCourse(page, name) {
  await page.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  await page.locator('.week-title').click();
  await page
    .getByRole('dialog', { name: '查看周课表', exact: true })
    .locator('.week-grid button')
    .first()
    .click();
  const card = page.locator('.calendar .course-card').filter({ hasText: name });
  await expect(card).toHaveCount(1);
  await card.click();
  const detail = page.getByRole('dialog', { name, exact: true });
  const text = (await detail.innerText()).replace(/\s/g, '');
  assert(text.includes('虚构教师'));
  assert(text.includes('桌面测试室'));
  await expect(detail).toContainText('1–2 节');
  await page.keyboard.press('Escape');
}

export async function prepareImportAndThemeRestart(page, dataDir, network) {
  const url = new URL(page.url());
  assert(
    url.hostname === 'tauri.localhost' ||
      (url.protocol === 'tauri:' && url.hostname === 'localhost'),
    'Native feature checks must use the bundled production page, not Vite',
  );
  assert(
    ![...network.local].some((request) => request.includes('/offline/ocr/')),
    'OCR resources were already loaded before the fresh-profile check',
  );
  await page.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  const original = await page.evaluate(async () => {
    const stored = await window.__TAURI_INTERNALS__.invoke('load_data');
    return JSON.parse(stored.payload);
  });
  const image = await syntheticTimetable(page);
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课程表图片或文件', { exact: true }).setInputFiles({
    name: '桌面虚构中文课表.png',
    mimeType: 'image/png',
    buffer: image,
  });
  try {
    await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程', {
      timeout: 180_000,
    });
  } catch (error) {
    await page.screenshot({ path: path.join(dataDir, 'import-failure-desktop.png') });
    const visibleErrors = await dialog.locator('.form-error').allTextContents();
    throw new Error(
      `Native OCR did not save automatically: ${visibleErrors.join(' ')}; blocked external requests: ${JSON.stringify([...network.external])}`,
      { cause: error },
    );
  }
  const persisted = await page.evaluate(async () => {
    const stored = await window.__TAURI_INTERNALS__.invoke('load_data');
    return JSON.parse(stored.payload);
  });
  const previousWorkspace = original.workspaces.find(
    (workspace) => workspace.id === original.activeWorkspaceId,
  );
  const after = persisted.workspaces.find(
    (workspace) => workspace.id === original.activeWorkspaceId,
  );
  assert.deepEqual(
    after.courses.slice(0, previousWorkspace.courses.length),
    previousWorkspace.courses,
  );
  assert.deepEqual({ ...after, courses: previousWorkspace.courses }, previousWorkspace);
  const initialOcrDrafts = after.courses.slice(previousWorkspace.courses.length);
  assert.equal(initialOcrDrafts.length, 1);
  const recognized = initialOcrDrafts[0];
  assert.equal(recognized.name.replace(/\s/g, ''), '桌面数字设计');
  assert.equal(recognized.teacher.replace(/\s/g, ''), '虚构教师');
  assert.equal(recognized.room.replace(/\s/g, ''), '桌面测试室');
  assert.equal(recognized.day, 1);
  assert.equal(recognized.start, 1);
  assert.equal(recognized.end, 2);
  assert.deepEqual(
    recognized.weeks,
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  const courseName = recognized.name;
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(dataDir, 'import-automatic-desktop.png') });
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await showImportedCourse(page, courseName);
  const ocrResources = assertNativeOffline(network, true);

  await page.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await page.getByRole('tab', { name: '外观与交互' }).click();
  const before = await page.locator('html').getAttribute('data-theme-pack');
  await page.getByRole('button', { name: '预览青空之丘', exact: true }).click();
  await expect(page.locator('.pack-preview-backdrop')).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector('.pack-preview-backdrop')?.naturalWidth > 0,
  );
  assert.equal(await page.locator('html').getAttribute('data-theme-pack'), before);
  await page.getByRole('button', { name: '应用主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  for (const [label, mode] of [
    ['浅色', 'light'],
    ['深色', 'dark'],
  ]) {
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  }
  assertNativeOffline(network);
  return { courseName, themePackId: 'sky-hill', importedWrites: 1, initialOcrDrafts, ocrResources };
}

export async function verifyImportAndThemeRestart(page, expected) {
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', expected.themePackId);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await showImportedCourse(page, expected.courseName);
}
