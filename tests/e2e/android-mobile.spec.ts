import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 393, height: 852 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  acceptDownloads: true,
});

test('Android layout imports the Windows backup, records attendance offline and restores it after restart', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-09-28T00:30:00.000Z') });
  await page.goto('/');

  await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
  await expect(page.getByRole('heading', { name: '数据与备份', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-navigation button')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const initialBackupPath = await (await downloadEvent).path();
  const backup = JSON.parse(await readFile(initialBackupPath!, 'utf8'));
  const workspace = backup.data.workspaces[0];
  workspace.id = 'windows-workspace-mobile-test';
  workspace.name = '虚构手机验收班';
  workspace.startDate = '2026-09-07';
  backup.data.activeWorkspaceId = workspace.id;
  workspace.students = [
    { id: 'mobile-student-a', name: '虚构同学甲', number: 'MOBILE001', group: '验收班' },
  ];
  workspace.courses = [
    {
      id: 'mobile-course-a',
      name: '虚构移动课程',
      teacher: '虚构教师',
      room: 'A101',
      day: 1,
      start: 1,
      end: 1,
      weeks: [4],
      color: 'blue',
    },
  ];
  workspace.records = [];
  backup.checksum = createHash('sha256').update(JSON.stringify(backup.data)).digest('hex');

  await page.getByRole('navigation').getByRole('button', { name: '数据与备份' }).click();
  await page.getByLabel('选择备份文件', { exact: true }).setInputFiles({
    name: 'Ludian_Windows_备份.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole('heading', { name: '首次导入到手机' })).toBeVisible();
  await expect(page.getByText('首次导入保留原工作台 ID')).toBeVisible();
  await page.getByRole('button', { name: '导入并初始化手机' }).click();

  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  await expect(page.locator('.mobile-agenda-course')).toContainText('虚构移动课程');
  await page.getByRole('navigation').getByRole('button', { name: '考勤工作台' }).click();
  await expect(page.getByLabel('登记课程')).toHaveValue('mobile-course-a');
  await page.getByRole('button', { name: '虚构同学甲迟到加一' }).click();
  await expect(page.getByRole('status')).toContainText('已登记 1 条迟到');
  await page.getByRole('navigation').getByRole('button', { name: '考勤记录' }).click();
  await expect(page.locator('.mobile-history-card')).toContainText('虚构移动课程');
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: '考勤记录' }).click();
  await expect(page.locator('.mobile-history-card')).toContainText('虚构同学甲');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
