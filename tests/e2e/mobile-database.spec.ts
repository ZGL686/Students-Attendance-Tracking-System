import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dataSchema, newWorkspace } from '../../src/model';

test.use({ viewport: { width: 400, height: 866 } });

function fictionalDatabase() {
  const workspace = newWorkspace('虚构数据库验收班', [
    { id: 'mobile-db-student', number: 'DB-TEST-001', name: '虚构数据库同学', group: '验收组' },
  ]);
  workspace.id = 'mobile-db-workspace';
  workspace.courses = [
    {
      id: 'mobile-db-course',
      name: '虚构数据库课程',
      teacher: '虚构教师',
      room: '虚构教室',
      day: 1,
      start: 1,
      end: 2,
      weeks: [1],
      color: 'blue',
    },
  ];
  workspace.records = [
    {
      id: 'mobile-db-record',
      studentId: 'mobile-db-student',
      category: 'late',
      date: '2026-10-12',
      time: '08:10',
      courseId: 'mobile-db-course',
      courseName: '虚构数据库课程',
      teacher: '虚构教师',
      room: '虚构教室',
      note: '虚构记录原备注',
      createdAt: '2026-10-12T00:10:00.000Z',
      updatedAt: '2026-10-12T00:10:00.000Z',
      voided: false,
    },
  ];
  for (const kind of ['students', 'records'] as const) {
    workspace.databases[kind].views[0].hidden = [];
    workspace.databases[kind].views[0].calculations =
      kind === 'students' ? { name: 'count', total: 'sum' } : { title: 'count' };
  }
  return dataSchema.parse({
    schemaVersion: 3,
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
  });
}

async function expectNoMobileCalculations(page: Page) {
  await expect(page.locator('.phone-database-rows')).toBeVisible();
  await expect(page.locator('.phone-database-calculations')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /列计算$/ })).toHaveCount(0);
  await expect(page.getByText('不计算', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('mobile student and attendance databases retain properties and editing without calculation controls', async ({
  page,
}, testInfo) => {
  await page.route('**/local-seed.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ name: '虚构数据库初始班', students: [] }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  // Playwright creates a fresh browser context; only synthetic snapshots are used.
  await page.evaluate(async (data) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('guilu-attendance', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').add({
        revision: 100,
        payload: JSON.stringify(data),
        savedAt: '2026-10-12T00:10:00.000Z',
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, fictionalDatabase());
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
  const navigation = page.getByRole('navigation', { name: '主要页面' });
  await navigation.getByRole('button', { name: '学生数据库', exact: true }).click();
  await page.getByRole('button', { name: '完整数据库', exact: true }).click();
  const student = page.locator('.phone-database-row');
  await expect(student).toHaveCount(1);
  await expect(student.locator('.phone-database-properties')).toContainText('DB-TEST-001');
  await expect(student.locator('.phone-database-properties')).toContainText('验收组');
  await expect(student.locator('.phone-database-properties')).toContainText('异常累计');
  await expectNoMobileCalculations(page);
  await expect(
    student.getByRole('button', { name: '虚构数据库同学的班级', exact: true }),
  ).toBeVisible();
  await student.locator('header > button').click();
  await expect(
    page.locator('.ui-drawer').getByRole('heading', { name: '虚构数据库同学', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator('.ui-drawer')).toHaveCount(0);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const newStudent = page.getByRole('dialog', { name: '新建同学', exact: true });
  await expect(newStudent.getByLabel('姓名', { exact: true })).toBeVisible();
  await expect(newStudent.getByRole('button', { name: '添加同学', exact: true })).toBeVisible();
  await newStudent.getByRole('button', { name: '取消', exact: true }).click();
  await expectNoMobileCalculations(page);
  await page.locator('.main-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.screenshot({ path: testInfo.outputPath('mobile-students-no-calculations.png') });

  await navigation.getByRole('button', { name: '考勤记录', exact: true }).click();
  await page.getByRole('button', { name: '完整数据库', exact: true }).click();
  const record = page.locator('.phone-database-row');
  await expect(record).toHaveCount(1);
  for (const value of ['虚构数据库同学', '2026-10-12', '08:10', '虚构数据库课程', '虚构记录原备注'])
    await expect(record.locator('.phone-database-properties')).toContainText(value);
  await expectNoMobileCalculations(page);
  await expect(
    record.getByRole('button', { name: '虚构数据库同学 · 迟到的备注', exact: true }),
  ).toBeVisible();
  await record.locator('header > button').click();
  await expect(
    page
      .locator('.ui-drawer')
      .getByRole('button', { name: '编辑完整记录 / 调整课程', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await expect(page.locator('.ui-drawer')).toHaveCount(0);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const newRecord = page.getByRole('dialog', { name: '补记考勤', exact: true });
  await expect(newRecord.getByLabel('课程名称', { exact: true })).toBeVisible();
  await expect(newRecord.getByRole('button', { name: '保存考勤', exact: true })).toBeVisible();
  await newRecord.getByRole('button', { name: '取消', exact: true }).click();
  await expectNoMobileCalculations(page);
  await page.locator('.main-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.screenshot({ path: testInfo.outputPath('mobile-records-no-calculations.png') });
});
