import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import type { AppData } from '../../src/model';

const header = '课程名称,任课教师,教室,星期,开始节次,结束节次,上课周次\n';
const row = '星际绘画,虚构教师,测试室,周日,9,10,1-16\n';

test.beforeEach(async ({ page }) => {
  await page.route('**/local-seed.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        name: '课表导入验收班',
        students: [{ id: 's1', number: 'T001', name: '虚构学生', group: '虚构班' }],
      }),
    }),
  );
  await page.clock.install({ time: new Date('2026-09-16T02:10:00Z') });
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

async function uploadCsv(page: Page, csv: string) {
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课程表图片或文件', { exact: true }).setInputFiles({
    name: '虚构课表.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(header + csv),
  });
  return dialog;
}

test('selecting a complete file automatically appends and persists without confirmation', async ({
  page,
}) => {
  const before = await snapshot(page);
  const dialog = await uploadCsv(page, row);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已导入 1 门课程');
  await expect(page.getByRole('button', { name: '识别并预览', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0);
  const saved = await snapshot(page);
  const original = before.data.workspaces[0];
  const current = saved.data.workspaces[0];
  expect(saved.revision).toBe(before.revision + 1);
  expect(current.courses).toHaveLength(original.courses.length + 1);
  expect(current.courses.slice(0, original.courses.length)).toEqual(original.courses);
  expect({ ...current, courses: original.courses }).toEqual(original);
  await page.reload();
  await expect(page.locator('.calendar .course-card').filter({ hasText: '星际绘画' })).toHaveCount(
    1,
  );
});

test('incomplete imports preserve the timetable and offer direct manual entry', async ({
  page,
}) => {
  const before = await snapshot(page);
  const dialog = await uploadCsv(page, '星际绘画,虚构教师,测试室,,9,10,\n');
  await expect(dialog.getByRole('region', { name: '手动补录课程', exact: true })).toBeVisible();
  await expect(dialog).toContainText('课表没有改动');
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByLabel('课程名称', { exact: true }).fill('虚构手动补课');
  await dialog.locator('.quick-course-entry select').selectOption('7');
  await dialog.getByLabel('开始节次', { exact: true }).fill('9');
  await dialog.getByLabel('结束节次', { exact: true }).fill('10');
  await dialog.getByLabel('上课周次', { exact: true }).fill('1-16双周');
  await dialog.getByRole('button', { name: '保存这门课程', exact: true }).click();
  await expect(dialog).toContainText('课程已添加');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  expect((await snapshot(page)).data.workspaces[0].courses.at(-1)).toMatchObject({
    name: '虚构手动补课',
    weeks: [2, 4, 6, 8, 10, 12, 14, 16],
  });
});

test('duplicates do not write again and a mixed batch saves only complete nonconflicting courses', async ({
  page,
}) => {
  await uploadCsv(page, row);
  await expect(page.getByRole('dialog', { name: '导入课程', exact: true })).toHaveCount(0);
  const before = await snapshot(page);
  let dialog = await uploadCsv(page, row);
  await expect(dialog).toContainText('已存在，没有重复添加');
  expect(await snapshot(page)).toEqual(before);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  dialog = await uploadCsv(
    page,
    row + '冲突课程,虚构教师,测试室,周日,9,10,1-16\n' + '月球摄影,虚构教师,测试室,周六,9,10,1-16\n',
  );
  await expect(dialog.locator('.import-summary')).toContainText(
    '已导入 1 门课程，跳过 1 门重复课程，1 项无法导入',
  );
  await expect(dialog.locator('.import-skipped')).toContainText('冲突课程');
  await expect(dialog.locator('.import-skipped')).toContainText('重叠');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  const after = await snapshot(page);
  expect(after.data.workspaces[0].courses).toHaveLength(
    before.data.workspaces[0].courses.length + 1,
  );
  expect(
    after.data.workspaces[0].courses.filter((course) => course.name === '星际绘画'),
  ).toHaveLength(1);
  expect(after.data.workspaces[0].courses.at(-1)?.name).toBe('月球摄影');
});

test('automatic append retains students and historical attendance', async ({ page }) => {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '考勤工作台', exact: true })
    .click();
  await page.getByRole('button', { name: '虚构学生迟到加一', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已登记');
  const before = await snapshot(page);
  await page.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  const dialog = await uploadCsv(page, row);
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const after = await snapshot(page);
  expect(after.data.workspaces[0].students).toEqual(before.data.workspaces[0].students);
  expect(after.data.workspaces[0].records).toEqual(before.data.workspaces[0].records);
  expect(after.data.workspaces[0].courses).toHaveLength(
    before.data.workspaces[0].courses.length + 1,
  );
});

test('a stale revision reports save failure without changing persisted courses or claiming success', async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await other.getByLabel('工作台名称', { exact: true }).fill('另一个虚构窗口已保存');
  await other.getByRole('button', { name: '保存学期设置', exact: true }).click();
  await expect(other.getByRole('status')).toContainText('已保存');
  const before = await snapshot(other);
  const dialog = await uploadCsv(page, row);
  await expect(dialog.getByRole('alert')).toContainText('导入未保存');
  await expect(page.getByRole('status')).toContainText('数据已在其他窗口更新');
  await expect(dialog.locator('.import-summary')).toHaveCount(0);
  expect(await snapshot(other)).toEqual(before);
});

test('an aborted storage transaction keeps the original snapshot and does not show imported success', async ({
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
      if (this.name === 'snapshots' && this.transaction.db.name === 'guilu-attendance')
        this.transaction.abort();
      return request;
    };
  });
  const dialog = await uploadCsv(page, row);
  await expect(dialog.getByRole('alert')).toContainText('导入未保存');
  await expect(dialog.locator('.import-summary')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
  await page.reload();
  await expect(page.locator('.calendar .course-card').filter({ hasText: '星际绘画' })).toHaveCount(
    0,
  );
});

test('cancellation while the local reader loads prevents a write', async ({ page }) => {
  let release = () => {};
  let intercepted = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/src/features/timetable-import/readExcel.ts*', async (route) => {
    intercepted = true;
    await pending;
    await route.continue();
  });
  const before = await snapshot(page);
  try {
    const dialog = await uploadCsv(page, row);
    await expect.poll(() => intercepted).toBe(true);
    await dialog.getByRole('button', { name: '取消导入', exact: true }).click();
    release();
    await expect(dialog.getByRole('alert')).toContainText('导入已取消');
    expect(await snapshot(page)).toEqual(before);
  } finally {
    release();
  }
});

test('all Excel worksheets import automatically and a merged grid uses the current term weeks', async ({
  page,
}) => {
  await page.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await page.getByLabel('学期总周数', { exact: true }).fill('18');
  await page.getByRole('button', { name: '保存学期设置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await page.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  const workbook = new ExcelJS.Workbook();
  workbook
    .addWorksheet('课程列表')
    .addRows([
      header.trim().split(','),
      ['星际绘画', '虚构教师', '测试室', '周六', '9', '10', '1-16'],
    ]);
  const grid = workbook.addWorksheet('网格课表');
  grid.addRows([['节次', '星期六', '星期日'], ['第9节', '', '虚构网格课程'], ['第10节']]);
  grid.mergeCells('C2:C3');
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课程表图片或文件', { exact: true }).setInputFiles({
    name: '多表虚构课表.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await expect(dialog.locator('.import-summary')).toContainText('已导入 2 门课程');
  await expect(dialog).toContainText('1–18 周');
  const courses = (await snapshot(page)).data.workspaces[0].courses;
  expect(courses.find((course) => course.name === '星际绘画')).toBeDefined();
  expect(courses.find((course) => course.name === '虚构网格课程')).toMatchObject({
    day: 7,
    start: 9,
    end: 10,
    weeks: Array.from({ length: 18 }, (_, index) => index + 1),
  });
});

test('unsupported legacy Excel explains conversion and leaves the timetable untouched', async ({
  page,
}) => {
  const before = await snapshot(page);
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课程表图片或文件', { exact: true }).setInputFiles({
    name: '旧课表.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from('legacy'),
  });
  await expect(dialog.getByRole('alert')).toContainText('另存为 .xlsx');
  expect(await snapshot(page)).toEqual(before);
});
