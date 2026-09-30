import { expect, test } from '@playwright/test';

for (const width of [360, 393, 430]) {
  test(`phone ${width}px supports editing, all pages and bounded overlays`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 852 });
    await page.route('**/local-seed.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ name: '虚构手机验收班', students: [] }),
      }),
    );
    await page.goto('/');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
    const fits = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      for (const dialog of await page.locator('dialog[open], .ui-drawer').all()) {
        await expect
          .poll(async () => {
            const box = await dialog.boundingBox();
            return box ? box.x >= 0 && box.x + box.width <= width + 1 : false;
          })
          .toBe(true);
      }
    };
    await page.getByRole('button', { name: '添加课程', exact: true }).click();
    await page.getByLabel('课程名称').fill('虚构手机课程');
    await page.getByLabel('上课周次').fill('1-16');
    await fits();
    await page.screenshot({ path: testInfo.outputPath('course-editor.png') });
    await page.getByRole('button', { name: '保存课程', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '整周课表', exact: true }).click();
    await expect(page.locator('.phone-calendar-scroll')).toBeVisible();
    await fits();
    await page
      .getByRole('navigation', { name: '主要页面' })
      .getByRole('button', { name: '学生数据库' })
      .click();
    await page.getByRole('button', { name: '添加学生', exact: true }).click();
    await page.getByLabel('姓名', { exact: true }).fill('虚构手机同学');
    await page.getByLabel('学号', { exact: true }).fill('MOBILE-TEST-001');
    await page.getByRole('button', { name: '添加同学', exact: true }).click();
    await expect(page.locator('.mobile-lookup-list')).toContainText('虚构手机同学');
    await page
      .locator('.mobile-lookup-card')
      .filter({ hasText: '虚构手机同学' })
      .getByRole('button')
      .click();
    await expect(page.locator('.ui-drawer')).toBeVisible();
    await fits();
    await page.getByRole('button', { name: '关闭详情' }).click();
    await page.getByRole('button', { name: '完整数据库', exact: true }).click();
    await expect(page.getByRole('button', { name: '数据库筛选', exact: true })).toBeVisible();
    await fits();
    await page.screenshot({ path: testInfo.outputPath('database.png') });
    for (const title of ['考勤汇总', '设置与偏好', '数据与备份']) {
      await page.getByRole('button', { name: '全部功能', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: title, exact: true }).click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await fits();
      await page.screenshot({ path: testInfo.outputPath(`${title}.png`) });
    }
    await page.getByRole('button', { name: '切换班级', exact: true }).click();
    await expect(page.getByRole('button', { name: '管理工作台', exact: true })).toBeVisible();
    await fits();
  });
}
