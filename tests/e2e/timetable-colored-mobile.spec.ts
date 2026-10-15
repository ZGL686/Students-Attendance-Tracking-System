import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import type { AppData } from '../../src/model';
import { fictionalCards } from './timetable-colored-fixture';

const phoneSelector = 'iframe[title="Ludian 手机预览"]';
const header = ['课程名称', '任课教师', '教室', '星期', '开始节次', '结束节次', '上课周次'];

async function phoneFrame(page: Page): Promise<Frame> {
  await expect(page.frameLocator(phoneSelector).locator('.app-shell')).toHaveAttribute(
    'data-mobile',
    'true',
  );
  const element = await page.locator(phoneSelector).elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('隔离测试的手机预览 iframe 未加载。');
  return frame;
}

async function snapshot(frame: Frame): Promise<{ data: AppData; revision: number }> {
  return frame.evaluate(async () => {
    const path = '/src/storage.ts';
    const { load } = await import(path);
    const stored = await load();
    if (!stored) throw new Error('隔离测试快照不存在。');
    return stored;
  });
}

async function openImport(frame: Frame) {
  await frame.getByRole('button', { name: '导入课程', exact: true }).click();
  return frame.getByRole('dialog', { name: '导入课程', exact: true });
}

test.beforeEach(async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await context.route('**/local-seed.json', (route) => route.fulfill({ status: 404, body: '' }));
  // This new nonpersistent context uses only the isolated phone simulator database.
  expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
  await page.goto('/phone-simulator.html');
  const frame = await phoneFrame(page);
  await expect(frame.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  await frame.evaluate(async () => {
    const environmentPath = '/src/browserEnvironment.ts';
    const { browserDatabaseName } = await import(environmentPath);
    if (browserDatabaseName !== 'ludian-phone-simulator')
      throw new Error('测试只能准备独立手机模拟器数据库。');
    const storagePath = '/src/storage.ts';
    const { load, save } = await import(storagePath);
    const current = await load();
    if (!current || current.data.workspaces.length !== 1)
      throw new Error('新建隔离测试工作台不符合预期。');
    const data = structuredClone(current.data);
    const workspace = data.workspaces[0];
    workspace.name = '虚构文件课表验收';
    workspace.term = '虚构 18 周学期';
    workspace.totalWeeks = 18;
    workspace.courses = [];
    await save(data, current.revision);
  });
  await page.reload();
  await phoneFrame(page);
});

test('400 × 866 phone imports verified Excel fields once, reloads and skips duplicates without OCR', async ({
  page,
  context,
}, testInfo) => {
  const unwantedRequests: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      unwantedRequests.push(url.origin);
      await route.abort();
    } else if (/\/(?:offline\/|[^/]*ocr[^/]*\.|readImages?\.)/i.test(url.pathname)) {
      unwantedRequests.push(url.pathname);
      await route.abort();
    } else await route.continue();
  });
  let frame = await phoneFrame(page);
  const before = await snapshot(frame);
  expect(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 400,
    height: 866,
  });
  const workbook = new ExcelJS.Workbook();
  workbook
    .addWorksheet('已核对课程')
    .addRows([
      header,
      ...fictionalCards.map((card) => [
        card.name,
        '测试老师',
        card.room,
        card.day,
        card.start,
        card.end,
        '1-18',
      ]),
    ]);
  const file = {
    name: '虚构已核对课表.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
  let dialog = await openImport(frame);
  const picker = dialog.getByLabel('选择课表文件', { exact: true });
  expect(await picker.evaluate((element) => (element as HTMLInputElement).multiple)).toBe(true);
  await expect(picker).toHaveAttribute('accept', /\.xlsx/);
  await expect(picker).toHaveAttribute('accept', /\.csv/);
  await expect(picker).not.toHaveAttribute('accept', /image|\.pdf|\.png|\.jpe?g/);
  await expect(dialog).toContainText('支持 Excel / CSV，选择后自动追加。已有课程保留。');
  await expect(dialog).not.toContainText(/OCR|识图|图片|目录图|第几周|置信度/);
  await page
    .locator(phoneSelector)
    .screenshot({ path: testInfo.outputPath('phone-file-import.png') });
  await picker.setInputFiles(file);
  await expect(dialog).toHaveCount(0);
  await expect(frame.getByRole('status')).toContainText('已导入 11 门课程');
  const saved = await snapshot(frame);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.data.workspaces[0].courses).toHaveLength(11);
  expect(new Set(saved.data.workspaces[0].courses.map((course) => course.name)).size).toBe(9);
  expect({ ...saved.data.workspaces[0], courses: [] }).toEqual(before.data.workspaces[0]);
  expect(
    saved.data.workspaces[0].courses
      .map(({ name, day, start, end, room, weeks }) => ({
        name,
        day,
        start,
        end,
        room,
        weeks,
      }))
      .sort((a, b) => a.day - b.day || a.start - b.start),
  ).toEqual(
    fictionalCards.map((card) => ({
      ...card,
      day: Number(card.day),
      start: Number(card.start),
      end: Number(card.end),
      weeks: Array.from({ length: 18 }, (_, index) => index + 1),
    })),
  );
  await page.reload();
  frame = await phoneFrame(page);
  await expect(frame.locator('.phone-calendar-scroll .course-card')).toHaveCount(11);
  expect(await snapshot(frame)).toEqual(saved);
  dialog = await openImport(frame);
  await dialog.getByLabel('选择课表文件', { exact: true }).setInputFiles(file);
  await expect(dialog.locator('.import-summary')).toContainText('11 门课程已存在，没有重复添加');
  expect(await snapshot(frame)).toEqual(saved);
  expect(unwantedRequests).toEqual([]);
});

test('phone explains a mistaken student list, empty sheet and missing course fields without writing', async ({
  page,
}, testInfo) => {
  const frame = await phoneFrame(page);
  const before = await snapshot(frame);
  const dialog = await openImport(frame);
  const picker = dialog.getByLabel('选择课表文件', { exact: true });
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('学生名单').addRows([
    ['学号', '姓名', '班级'],
    ['T001', '虚构同学', '虚构班'],
  ]);
  await picker.setInputFiles({
    name: '虚构学生名单.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(dialog.getByRole('status')).toContainText('学生名单');
  await expect(dialog).toContainText('课表没有改动');
  await expect(dialog.getByLabel('课程名称', { exact: true })).toBeHidden();
  expect(await snapshot(frame)).toEqual(before);
  await page
    .locator(phoneSelector)
    .screenshot({ path: testInfo.outputPath('phone-wrong-student-file.png') });
  await picker.setInputFiles({
    name: '空表.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('\n,,\n'),
  });
  await expect(dialog.getByRole('status')).toContainText(/空|没有内容/);
  expect(await snapshot(frame)).toEqual(before);
  await picker.setInputFiles({
    name: '缺字段.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('课程名称,任课教师\n虚构课程,测试老师\n'),
  });
  await expect(dialog.getByRole('status')).toContainText('星期');
  await expect(dialog.getByRole('status')).toContainText('节次');
  await expect(dialog).not.toContainText(/OCR|清晰图片|识别失败/);
  expect(await snapshot(frame)).toEqual(before);
  await picker.setInputFiles({
    name: '误选课表图片.png',
    mimeType: 'image/png',
    buffer: Buffer.from('unsupported image input'),
  });
  await expect(dialog.getByRole('alert')).toContainText('请选择 Excel');
  await expect(dialog.locator('.import-progress')).toHaveCount(0);
  expect(await snapshot(frame)).toEqual(before);
});

test('phone reports student CSV selected with a valid course file and saves only the course', async ({
  page,
}) => {
  const frame = await phoneFrame(page);
  const before = await snapshot(frame);
  const dialog = await openImport(frame);
  await dialog.getByLabel('选择课表文件', { exact: true }).setInputFiles([
    {
      name: '误选学生名单.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('学号,姓名\nT001,虚构学生\n'),
    },
    {
      name: '虚构课表.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${header.join(',')}\n星际绘画,测试老师,测试室,周日,9,10,1-18\n`),
    },
  ]);
  await expect(dialog.locator('.import-summary')).toContainText('已导入 1 门课程');
  await expect(dialog).toContainText('误选学生名单.csv');
  await expect(dialog).toContainText('学生名单');
  const after = await snapshot(frame);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.data.workspaces[0].courses).toHaveLength(1);
  expect(after.data.workspaces[0].students).toEqual(before.data.workspaces[0].students);
  expect(after.data.workspaces[0].records).toEqual(before.data.workspaces[0].records);
});
