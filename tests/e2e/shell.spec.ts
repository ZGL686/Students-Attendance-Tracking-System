import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/local-seed.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        name: '交互验收班',
        students: [{ id: 's1', name: '虚构同学甲', number: 'TEST001', group: '演示班' }],
      }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
});

async function appearance(page: Page) {
  await page.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await page.getByRole('tab', { name: '外观与交互' }).click();
}

async function snapshotCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('guilu-attendance', 1);
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction('snapshots').objectStore('snapshots').count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
          count.onerror = () => reject(count.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

test('sidebar stays usable on every page and across viewport changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const name of ['课程表', '考勤工作台', '学生数据库', '考勤记录', '考勤汇总', '数据与备份']) {
    await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    for (const width of [1100, 1440, 2048]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
      await expect
        .poll(async () => Math.round((await page.locator('.app-main').boundingBox())!.width))
        .toBe(width);
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      const reopen = page.getByRole('button', { name: '展开侧栏', exact: true });
      await expect(reopen).toBeInViewport();
      await reopen.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation')).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test('collapsed preference survives reload and remains keyboard recoverable', async ({ page }) => {
  const count = await snapshotCount(page);
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await page.reload();
  const toggle = page.getByRole('button', { name: '展开侧栏' });
  await expect(toggle).toBeInViewport();
  await expect(page.locator('.app-main')).toHaveCSS('width', '1440px');
  await toggle.focus();
  await expect(page.getByRole('tooltip')).toHaveText('展开侧栏');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '切换班级' })).toBeVisible();
  expect(await snapshotCount(page)).toBe(count);
});

test('one workspace entry supports outside click, escape and creation', async ({ page }) => {
  const trigger = page.getByRole('button', { name: '切换班级', exact: true });
  await expect(trigger).toHaveCount(1);
  await expect(page.locator('.workspace-list, .brand')).toHaveCount(0);
  await trigger.click();
  await expect(page.getByRole('dialog', { name: '班级工作台' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog', { name: '班级工作台' })).toHaveCount(0);
  await trigger.click();
  await page.getByRole('heading', { name: '课程表', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '班级工作台' })).toHaveCount(0);
  await trigger.click();
  await page.getByRole('button', { name: '新建工作台', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('新建考勤工作台');
  await page.getByRole('dialog').click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭弹窗' }).hover();
  await expect(page.getByRole('dialog').getByRole('tooltip')).toHaveText('关闭弹窗');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
});

test('four font options apply globally, load offline and persist without attendance writes', async ({
  page,
}) => {
  const count = await snapshotCount(page);
  await appearance(page);
  await page.getByRole('radio', { name: /柔和圆体/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /手写文楷/ })).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'handwritten');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  for (const [label, id, postscript] of [
    ['柔和圆体', 'rounded', 'LudianRounded'],
    ['手写文楷', 'handwritten', 'LudianHand'],
    ['简洁黑体', 'sans', 'NotoSansSC'],
    ['系统字体', 'system', ''],
  ] as const) {
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('data-font', id);
    if (postscript) {
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: 'h1',
      });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      expect(
        fonts.some((font) => font.isCustomFont && font.postScriptName.startsWith(postscript)),
      ).toBe(true);
    }
  }
  await page.getByRole('radio', { name: /手写文楷/ }).click();
  await page.getByRole('button', { name: '大字 · 16' }).click();
  await expect(page.locator('html')).toHaveCSS('font-size', '16px');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'handwritten');
  await expect(page.locator('html')).toHaveCSS('font-size', '16px');
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  expect(await snapshotCount(page)).toBe(count);
  await appearance(page);
  await page.getByRole('button', { name: '恢复外观默认' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'rounded');
  await expect(page.locator('html')).toHaveCSS('font-size', '14px');
});

test('shared feedback covers hover, press, focus and reduced motion', async ({ page }) => {
  const toggle = page.getByRole('button', { name: '收起侧栏' });
  const background = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  await toggle.hover();
  await expect
    .poll(() => toggle.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(background);
  await expect(page.getByRole('tooltip')).toHaveText('收起侧栏');
  await page.mouse.down();
  await expect(toggle).toHaveCSS('background-color', 'rgb(230, 229, 225)');
  await page.mouse.move(400, 80);
  await page.mouse.up();
  await page.keyboard.press('Tab');
  await toggle.focus();
  await expect(toggle).toHaveCSS('outline-style', 'solid');
  await appearance(page);
  await page.getByLabel('减少动态效果').check();
  await expect(toggle).toHaveCSS('transition-duration', '0s');
  await page.getByLabel('减少动态效果').uncheck();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(toggle).toHaveCSS('transition-duration', '0s');
  await page.getByRole('navigation').getByRole('button', { name: '学生数据库' }).click();
  await page.locator('.database-row-title').filter({ hasText: '虚构同学甲' }).click();
  await expect(page.locator('.ui-drawer')).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: '关闭详情' }).click();
  await expect(page.locator('.ui-drawer')).toHaveCount(0);
});

test('invalid or unavailable preference storage never blocks attendance', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('ludian.preferences.v2', '{invalid'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'rounded');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('test blocked', 'QuotaExceededError');
    };
  });
  await appearance(page);
  await page.getByRole('radio', { name: /手写文楷/ }).click();
  await expect(page.getByRole('status')).toContainText('仅在本次打开时生效');
  await page.getByRole('navigation').getByRole('button', { name: '考勤工作台' }).click();
  await page.getByLabel('登记课程', { exact: true }).selectOption('');
  await page.getByLabel('临时课程名称', { exact: true }).fill('偏好隔离验收课');
  await page.getByRole('button', { name: '虚构同学甲迟到加一' }).click();
  await expect(page.getByRole('status')).toContainText('已登记 1 条迟到');
});

test('a rendering failure leaves navigation and saved data available', async ({ page }) => {
  await page.route('**/src/Reports.tsx*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'export function Reports() { throw new Error("intentional rendering test"); }',
    }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  const before = await snapshotCount(page);
  await page.getByRole('navigation').getByRole('button', { name: '考勤汇总', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('这个页面暂时出了点问题');
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('button', { name: '返回课程表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  expect(await snapshotCount(page)).toBe(before);
});
