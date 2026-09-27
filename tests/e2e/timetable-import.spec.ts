import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import ExcelJS from 'exceljs';

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

async function preview(page: Page, csv: string) {
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课表文件', { exact: false }).setInputFiles({
    name: '虚构课表.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(header + csv),
  });
  await dialog.getByRole('button', { name: '识别并预览', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '下一步：确认保存' })).toBeVisible();
  return dialog;
}

test('missing fields are editable, canceled previews do not save and confirmed imports survive reload', async ({
  page,
}) => {
  let dialog = await preview(page, '星际绘画,虚构教师,测试室,,9,10,\n');
  const next = dialog.getByRole('button', { name: '下一步：确认保存' });
  await expect(next).toBeDisabled();
  const draft = dialog.getByRole('region', { name: '待导入课程 1', exact: true });
  await expect(draft.getByLabel('上课周次', { exact: true })).toHaveValue('');
  await draft.getByLabel('星期', { exact: true }).selectOption('7');
  await draft.getByLabel('上课周次', { exact: true }).fill('1-16双周');
  await expect(next).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.calendar .course-card').filter({ hasText: '星际绘画' })).toHaveCount(
    0,
  );
  dialog = await preview(page, row);
  await dialog.getByRole('button', { name: '下一步：确认保存' }).click();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.calendar .course-card').filter({ hasText: '星际绘画' })).toHaveCount(
    1,
  );
});

test('duplicate courses are skipped and overlaps must be corrected or excluded', async ({
  page,
}) => {
  let dialog = await preview(page, row);
  await dialog.getByRole('button', { name: '下一步：确认保存' }).click();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  dialog = await preview(
    page,
    row + '冲突课程,虚构教师,测试室,周日,9,10,1-16\n' + '月球摄影,虚构教师,测试室,周六,9,10,1-16\n',
  );
  await expect(dialog.getByRole('button', { name: '下一步：确认保存' })).toBeDisabled();
  await expect(dialog.getByRole('region', { name: '待导入课程 2' })).toContainText('重叠');
  await dialog.getByLabel('导入第 2 门', { exact: true }).uncheck();
  await expect(dialog.locator('.import-summary')).toContainText('跳过 1 门完全重复课程');
  await dialog.getByRole('button', { name: '下一步：确认保存' }).click();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.locator('.calendar .course-card').filter({ hasText: '星际绘画' })).toHaveCount(
    1,
  );
  await expect(page.locator('.calendar .course-card').filter({ hasText: '月球摄影' })).toHaveCount(
    1,
  );
});

test('replacement confirmation shows the removed count and keeps historical attendance', async ({
  page,
}) => {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '考勤工作台', exact: true })
    .click();
  await page.getByRole('button', { name: '虚构学生迟到加一', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已登记');
  await page.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  const dialog = await preview(page, row);
  await dialog.getByRole('radio', { name: '替换当前工作台课表', exact: true }).check();
  await dialog.getByRole('button', { name: '下一步：确认保存' }).click();
  await expect(dialog).toContainText('原有的 12 门课程');
  await dialog.getByRole('button', { name: '确认替换并导入', exact: true }).click();
  await page.reload();
  await expect(page.locator('.calendar .course-card')).toHaveCount(1);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: '考勤工作台', exact: true })
    .click();
  await page.getByRole('button', { name: '查看虚构学生明细', exact: true }).click();
  await expect(page.locator('.record-item')).toContainText('计算机程序设计');
});

test('a revision conflict keeps the import preview and leaves persisted courses unchanged', async ({
  page,
  context,
}) => {
  const dialog = await preview(page, row);
  await dialog.getByRole('button', { name: '下一步：确认保存' }).click();
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await other.getByLabel('工作台名称', { exact: true }).fill('另一个窗口保存的班级');
  await other.getByRole('button', { name: '保存学期设置' }).click();
  await expect(other.getByRole('status')).toContainText('已保存');
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('数据已在其他窗口更新');
  await dialog.getByRole('button', { name: '关闭通知' }).click();
  await dialog.getByRole('button', { name: '返回检查' }).click();
  await expect(dialog.getByLabel('课程名称', { exact: true })).toHaveValue('星际绘画');
  await other.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  await expect(other.locator('.calendar .course-card').filter({ hasText: '星际绘画' })).toHaveCount(
    0,
  );
});

test('Excel import reads only the selected worksheet', async ({ page }) => {
  const workbook = new ExcelJS.Workbook();
  const first = workbook.addWorksheet('默认工作表');
  first.addRows([header.trim().split(','), ['不应导入的课程', '', '', '周二', '1', '2', '1-16']]);
  const second = workbook.addWorksheet('目标工作表');
  second.addRows([header.trim().split(','), row.trim().split(',')]);
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课表文件', { exact: false }).setInputFiles({
    name: '多表虚构课表.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await dialog.getByRole('checkbox', { name: '默认工作表', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: '目标工作表', exact: true }).check();
  await dialog.getByRole('button', { name: '识别并预览', exact: true }).click();
  await expect(dialog.getByRole('region', { name: /待导入课程/ })).toHaveCount(1);
  await expect(dialog.getByLabel('课程名称', { exact: true })).toHaveValue('星际绘画');
  await expect(dialog.getByRole('button', { name: '下一步：确认保存' })).toBeEnabled();
});

test('unsupported legacy Excel explains conversion and offers an empty manual draft', async ({
  page,
}) => {
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课表文件', { exact: false }).setInputFiles({
    name: '旧课表.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from('legacy'),
  });
  await expect(dialog.getByRole('alert')).toContainText('另存为 .xlsx');
  await dialog.getByRole('button', { name: '手动填写课程', exact: true }).click();
  await expect(dialog.getByLabel('课程名称', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('上课周次', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '下一步：确认保存' })).toBeDisabled();
});
