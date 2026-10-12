import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';
import type { AppData } from '../../src/model';
import { coloredTimetableFixtures, fictionalCards } from './timetable-colored-fixture';

const phoneSelector = 'iframe[title="Ludian 手机预览"]';

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

test('400 × 866 phone simulator automatically saves both OCR images as a full-term timetable', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1080 });
  const remote: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') await route.continue();
    else {
      remote.push(url.origin);
      await route.abort();
    }
  });
  await context.route('**/local-seed.json', (route) => route.fulfill({ status: 404, body: '' }));
  // Playwright supplies a new nonpersistent context; this never opens the user's browser store.
  expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
  await page.goto('/phone-simulator.html');
  let frame = await phoneFrame(page);
  await expect(frame.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  const initial = await snapshot(frame);
  expect(initial.data.workspaces[0].students).toEqual([]);
  expect(initial.data.workspaces[0].records).toEqual([]);
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
    workspace.name = '虚构彩色课表验收';
    workspace.term = '虚构 18 周学期';
    workspace.totalWeeks = 18;
    workspace.courses = [];
    await save(data, current.revision);
  });
  await page.reload();
  frame = await phoneFrame(page);
  await expect(frame.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  const before = await snapshot(frame);
  expect(before.data.workspaces[0].courses).toEqual([]);
  expect(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 400,
    height: 866,
  });
  const fixture = await coloredTimetableFixtures(page);
  await frame.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = frame.getByRole('dialog', { name: '导入课程', exact: true });
  const picker = dialog.getByLabel('选择课程表图片或文件', { exact: true });
  expect(await picker.evaluate((element) => (element as HTMLInputElement).multiple)).toBe(true);
  await picker.setInputFiles([
    {
      name: '虚构课程目录.png',
      mimeType: 'image/png',
      buffer: Buffer.from(fixture.catalog, 'base64'),
    },
    {
      name: '虚构彩色课表.png',
      mimeType: 'image/png',
      buffer: Buffer.from(fixture.timetable, 'base64'),
    },
  ]);
  await expect(dialog.locator('.import-summary')).toContainText(
    '已导入 11 门课程，跳过 0 门重复课程',
    { timeout: 180_000 },
  );
  await expect(dialog).toContainText('11 门课程未标注周次，已按当前学期 1–18 周导入。');
  await expect(dialog.locator('.import-progress')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0);
  const saved = await snapshot(frame);
  const current = saved.data.workspaces[0];
  expect(saved.revision).toBe(before.revision + 1);
  expect(current.courses).toHaveLength(11);
  expect(new Set(current.courses.map((course) => course.name)).size).toBe(9);
  const signature = current.courses
    .map(({ name, day, start, end, room, weeks }) => ({ name, day, start, end, room, weeks }))
    .sort((a, b) => a.day - b.day || a.start - b.start);
  expect(signature).toEqual(
    fictionalCards.map((card) => ({
      ...card,
      day: Number(card.day),
      start: Number(card.start),
      end: Number(card.end),
      weeks: Array.from({ length: 18 }, (_, index) => index + 1),
    })),
  );
  expect({ ...current, courses: [] }).toEqual(before.data.workspaces[0]);
  expect(current.students).toEqual([]);
  expect(current.records).toEqual([]);
  expect(current).not.toHaveProperty('catalog');
  await dialog.locator('.import-summary').scrollIntoViewIfNeeded();
  await page.locator(phoneSelector).screenshot({
    path: testInfo.outputPath('phone-400x866-import-summary.png'),
  });
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(frame.locator('.phone-calendar-scroll .course-card')).toHaveCount(11);
  await page.locator(phoneSelector).screenshot({
    path: testInfo.outputPath('phone-400x866-imported-timetable.png'),
  });
  await page.reload();
  frame = await phoneFrame(page);
  await expect(frame.locator('.phone-calendar-scroll .course-card')).toHaveCount(11);
  expect(await snapshot(frame)).toEqual(saved);
  await frame
    .getByRole('navigation', { name: '主要页面' })
    .getByRole('button', { name: '学生数据库', exact: true })
    .click();
  await expect(frame.getByText('还没有导入学生名单', { exact: true })).toBeVisible();
  await expect(frame.getByText(/示例同学/)).toHaveCount(0);
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(remote).toEqual([]);
});
