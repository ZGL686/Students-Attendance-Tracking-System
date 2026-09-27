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
    canvas.height = 450;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic timetable canvas could not be created');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.font = '36px "Microsoft YaHei", sans-serif';
    context.fillText('星期一', 150, 70);
    context.fillText('星期二', 480, 70);
    context.fillText('数字设计', 135, 170);
    context.fillText('1-16周', 135, 225);
    context.fillText('第1-2节', 135, 280);
    context.fillText('1', 20, 170);
    context.fillText('2', 20, 280);
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
  await expect(detail).toContainText('虚构教师');
  await expect(detail).toContainText('桌面测试室');
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
  const image = await syntheticTimetable(page);
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课表文件', { exact: false }).setInputFiles({
    name: '桌面虚构中文课表.png',
    mimeType: 'image/png',
    buffer: image,
  });
  await dialog.getByRole('button', { name: '识别并预览', exact: true }).click();
  const next = dialog.getByRole('button', { name: '下一步：确认保存', exact: true });
  try {
    await next.waitFor({ timeout: 180_000 });
  } catch (error) {
    await page.screenshot({ path: path.join(dataDir, 'import-failure-desktop.png') });
    const visibleErrors = await dialog.locator('.form-error').allTextContents();
    throw new Error(
      `Native OCR did not reach preview: ${visibleErrors.join(' ')}; blocked external requests: ${JSON.stringify([...network.external])}`,
      { cause: error },
    );
  }
  const rows = dialog.getByRole('region', { name: /待导入课程 \d+/ });
  let recognized;
  const initialOcrDrafts = [];
  for (let index = 0; index < (await rows.count()); index++) {
    const row = rows.nth(index);
    const name = await row.getByLabel('课程名称', { exact: true }).inputValue();
    const day = await row.getByRole('combobox', { name: '星期', exact: true }).inputValue();
    const weeks = await row.getByLabel('上课周次', { exact: true }).inputValue();
    initialOcrDrafts.push({ name, day, weeks });
    if (!recognized && name.replace(/\s/g, '').includes('数字设计') && day === '1' && weeks.trim())
      recognized = row;
    else await row.getByRole('checkbox').uncheck();
  }
  assert(
    recognized,
    `Bundled offline OCR did not recognize the Chinese timetable: ${JSON.stringify(initialOcrDrafts)}`,
  );
  const courseName = '桌面数字设计';
  // Exercise the review form after proving that OCR produced the expected fields.
  await recognized.getByLabel('课程名称', { exact: true }).fill(courseName);
  await recognized.getByLabel('任课教师', { exact: true }).fill('虚构教师');
  await recognized.getByLabel('教室', { exact: true }).fill('桌面测试室');
  await recognized.getByLabel('开始节次', { exact: true }).fill('1');
  await recognized.getByLabel('结束节次', { exact: true }).fill('2');
  await recognized.getByLabel('上课周次', { exact: true }).fill('1-16');
  await expect(
    dialog.getByRole('radio', { name: '追加课程，跳过完全重复项', exact: true }),
  ).toBeChecked();
  await expect(next).toBeEnabled();
  await page.screenshot({ path: path.join(dataDir, 'import-preview-desktop.png') });
  await next.click();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
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
