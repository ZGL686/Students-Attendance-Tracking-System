import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 393, height: 852 },
  userAgent:
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
});

test('phone imports and edits courses, selects students for batch attendance and exports reports', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date('2026-09-28T00:30:00Z') });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '主要页面' });
  await nav.getByRole('button', { name: '课程表', exact: true }).click();
  await page.getByRole('button', { name: '导入课程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入课程', exact: true });
  await dialog.getByLabel('选择课表文件', { exact: false }).setInputFiles({
    name: '虚构手机课表.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '课程名称,任课教师,教室,星期,开始节次,结束节次,上课周次\n虚构手机实践,虚构老师,测试室,周一,1,2,1-16\n',
    ),
  });
  await dialog.getByRole('button', { name: '识别并预览', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '下一步：确认保存' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('phone-import.png') });
  await dialog.getByRole('button', { name: '下一步：确认保存' }).click();
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click();
  await page.locator('.mobile-agenda-course').filter({ hasText: '虚构手机实践' }).click();
  await page.getByRole('button', { name: '编辑课程', exact: true }).click();
  await page.getByLabel('教室', { exact: true }).fill('修改后的测试室');
  await page.getByRole('button', { name: '保存课程', exact: true }).click();
  await expect(page.locator('.mobile-agenda-course')).toContainText('修改后的测试室');
  await page.screenshot({ path: testInfo.outputPath('phone-schedule.png') });
  await nav.getByRole('button', { name: '学生数据库', exact: true }).click();
  await page.getByRole('button', { name: '添加学生', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill('虚构批量同学');
  await page.getByLabel('学号', { exact: true }).fill('PHONE-BATCH-001');
  await page.getByRole('button', { name: '添加同学', exact: true }).click();
  await nav.getByRole('button', { name: '考勤工作台', exact: true }).click();
  await page
    .getByLabel('登记课程', { exact: true })
    .selectOption({ label: '虚构手机实践 · 1–2 节' });
  await page.getByLabel('选择虚构批量同学', { exact: true }).check();
  await page.getByRole('button', { name: '批量登记 (1)', exact: true }).click();
  await page
    .getByRole('dialog', { name: '批量登记', exact: true })
    .getByRole('button', { name: '迟到', exact: true })
    .click();
  await expect(page.locator('.undo-bar')).toContainText('当前有效 1 条');
  await page.getByRole('button', { name: '虚构批量同学迟到减一', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '虚构批量同学的迟到明细', exact: true });
  await detail.getByRole('button', { name: '编辑记录', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '修改考勤明细', exact: true });
  await editor.getByLabel('备注', { exact: true }).fill('虚构手机编辑验收');
  await editor.getByRole('button', { name: '保存考勤', exact: true }).click();
  await expect(detail).toContainText('虚构手机编辑验收');
  await detail.getByRole('button', { name: '撤销', exact: true }).click();
  await detail.getByLabel('显示已撤销记录').check();
  await detail.getByRole('button', { name: '恢复', exact: true }).click();
  await detail.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '查看汇总', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.reload();
  await nav.getByRole('button', { name: '课程表', exact: true }).click();
  await expect(page.locator('.mobile-agenda-course')).toContainText('修改后的测试室');
  await page.getByRole('button', { name: '全部功能', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '设置与偏好', exact: true }).click();
  await page.getByRole('tab', { name: '外观与交互' }).click();
  await page.getByRole('button', { name: '预览青空之丘', exact: true }).click();
  await page.getByRole('button', { name: '应用主题', exact: true }).click();
  await page.getByRole('radio', { name: '深色', exact: false }).click();
  await nav.getByRole('button', { name: '课程表', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('phone-dark-theme.png') });
  await page.setViewportSize({ width: 852, height: 393 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '添加课程', exact: true }).click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(393);
});
