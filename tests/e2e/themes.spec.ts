import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { builtinThemes, themeCategories } from '../../src/features/themes/builtins';

async function appearance(page: Page) {
  await page.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await page.getByRole('tab', { name: '外观与交互' }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/local-seed.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        name: '主题验收班',
        students: [{ id: 's1', name: '虚构同学', number: 'THEME001', group: '演示班' }],
      }),
    }),
  );
});
test('preview never applies until confirmed, and complete themes persist independently of brightness', async ({
  page,
}) => {
  await page.goto('/');
  await appearance(page);
  await page.getByRole('button', { name: '预览青空之丘', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await page.getByRole('checkbox', { name: '预览深色' }).check();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await page.getByRole('button', { name: '预览青空之丘', exact: true }).click();
  await page.getByRole('button', { name: '应用主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  await page.getByRole('radio', { name: '深色', exact: false }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await appearance(page);
  await page.getByRole('button', { name: '预览经典主题', exact: true }).click();
  await page.getByRole('button', { name: '应用主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
test('version one preferences migrate without altering prior fields or default appearance', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'ludian.preferences.v1',
      JSON.stringify({
        version: 1,
        theme: 'dark',
        font: 'handwritten',
        fontSize: 16,
        motion: 'reduced',
        sidebarCollapsed: false,
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await expect(page.locator('html')).toHaveAttribute('data-font', 'handwritten');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('font-size', '16px');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('ludian.preferences.v2')!)),
  ).toEqual({
    version: 2,
    theme: 'dark',
    font: 'handwritten',
    fontSize: 16,
    motion: 'reduced',
    sidebarCollapsed: false,
    themePackId: 'classic',
    themePackVersion: '1.0.0',
  });
  await appearance(page);
  await page.getByRole('radio', { name: /系统字体/ }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('font-size', '16px');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(
    await page.evaluate(() => ({
      legacyFont: JSON.parse(localStorage.getItem('ludian.preferences.v1')!).font,
      currentFont: JSON.parse(localStorage.getItem('ludian.preferences.v2')!).font,
    })),
  ).toEqual({ legacyFont: 'handwritten', currentFont: 'system' });
});
test('all eighteen themes have local artwork and apply without changing typography or motion', async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await appearance(page);
  await page.getByRole('radio', { name: /手写文楷/ }).click();
  await page.getByLabel('减少动态效果').check();
  await expect(page.locator('.pack-card')).toHaveCount(19);
  for (const theme of builtinThemes) {
    await page.getByRole('button', { name: `预览${theme.definition.name}`, exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('.pack-preview-backdrop')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: '应用主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme-pack', theme.definition.id);
    await expect(page.locator('html')).toHaveAttribute('data-font', 'handwritten');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await expect(
      page.getByRole('button', { name: `预览${theme.definition.name}`, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
  await context.setOffline(true);
  await page.getByRole('button', { name: '预览青空之丘', exact: true }).click();
  await page.getByRole('button', { name: '应用主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  await expect(
    page.getByText('所有主题随应用提供，可离线使用；外观选择仅保存在这台设备。'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /登录|刷新主题|下载/ })).toHaveCount(0);
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'sky-hill');
  await expect(page.locator('html')).toHaveAttribute('data-font', 'handwritten');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
test('category filters are accessible and previews support keyboard selection without applying', async ({
  page,
}) => {
  await page.goto('/');
  await appearance(page);
  for (const [category, name] of Object.entries(themeCategories)) {
    const filter = page
      .getByRole('group', { name: '主题风格' })
      .getByRole('button', { name, exact: true });
    await filter.focus();
    await page.keyboard.press('Enter');
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pack-card')).toHaveCount(
      builtinThemes.filter((theme) => theme.definition.category === category).length,
    );
  }
  const preview = page.locator('.pack-card').first();
  await preview.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(preview).toBeFocused();
});
test('unavailable older theme preferences fall back to classic without blocking the application', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'ludian.preferences.v2',
      JSON.stringify({
        version: 2,
        theme: 'dark',
        font: 'sans',
        themePackId: 'unavailable-pack',
        themePackVersion: '3.0.0',
      }),
    ),
  );
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'classic');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await appearance(page);
  await expect(
    page.getByText('之前选择的主题不在本版中，已使用经典外观，可重新选择喜欢的主题。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '预览水墨江南', exact: true }).click();
  await page.getByRole('button', { name: '应用主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-pack', 'ink-jiangnan');
});
