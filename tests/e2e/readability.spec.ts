import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dataSchema, newWorkspace } from '../../src/model';
import { builtinThemes } from '../../src/features/themes/builtins';
import { expectReadable } from './readability-helpers';

test.use({ actionTimeout: 10_000 });

function syntheticData() {
  const workspace = newWorkspace('虚构可读性验收班', [
    { id: 'contrast-student', number: 'CONTRAST001', name: '虚构验收同学', group: '虚构组' },
  ]);
  workspace.id = 'contrast-workspace';
  workspace.startDate = '2026-09-07';
  workspace.courses = [
    {
      id: 'contrast-course',
      name: '虚构视觉课程',
      teacher: '虚构教师',
      room: '虚构教室',
      day: 1,
      start: 1,
      end: 2,
      weeks: [4],
      color: 'blue',
    },
  ];
  workspace.records = [false, true].map((voided, index) => ({
    id: `contrast-record-${index}`,
    studentId: 'contrast-student',
    category: 'late',
    date: '2026-09-28',
    time: '08:10',
    courseId: 'contrast-course',
    courseName: '虚构视觉课程',
    teacher: '虚构教师',
    room: '虚构教室',
    note: '虚构备注信息',
    createdAt: '2026-09-28T00:10:00.000Z',
    updatedAt: '2026-09-28T00:10:00.000Z',
    voided,
  }));
  return dataSchema.parse({
    schemaVersion: 3,
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
  });
}

async function prepare(page: Page, mobile: boolean) {
  await page.setViewportSize(mobile ? { width: 393, height: 852 } : { width: 1440, height: 1000 });
  await page.clock.install({ time: new Date('2026-09-28T00:30:00.000Z') });
  await page.route('**/local-seed.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.addInitScript(() =>
    localStorage.setItem(
      'ludian.preferences.v2',
      JSON.stringify({
        version: 2,
        theme: 'light',
        themePackId: 'classic',
        themePackVersion: '1.0.0',
        font: 'system',
        fontSize: 16,
        motion: 'reduced',
        sidebarCollapsed: false,
      }),
    ),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  // This new Playwright context contains synthetic data only.
  await page.evaluate(async (data) => {
    const path = '/src/storage.ts';
    const { load, save } = await import(path);
    const stored = await load();
    if (!stored) throw new Error('Fresh synthetic browser storage was not initialized.');
    await save(data, stored.revision);
  }, syntheticData());
  await page.reload();
  await expect(page.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
}

async function appearance(
  page: Page,
  themePackId: string,
  theme: 'light' | 'dark',
  wallpaper?: string,
) {
  await page.evaluate(
    async ({ themePackId, theme, wallpaper }) => {
      localStorage.setItem(
        'ludian.preferences.v2',
        JSON.stringify({
          version: 2,
          visualThemeVersion: 1,
          theme,
          themePackId,
          themePackVersion: '1.0.0',
          font: 'system',
          fontSize: 16,
          motion: 'reduced',
          sidebarCollapsed: false,
          glassTransparency: 70,
          ...(wallpaper ? { wallpaper } : {}),
        }),
      );
      const path = '/src/preferences/PreferencesProvider.tsx';
      const { initializePreferences } = await import(path);
      initializePreferences();
    },
    { themePackId, theme, wallpaper },
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  if (themePackId === 'custom')
    await expect(page.locator('html')).toHaveAttribute('data-visual-background', 'true');
  else await expect(page.locator('html')).toHaveAttribute('data-theme-pack', themePackId);
}

async function navigate(page: Page, title: string, mobile: boolean) {
  if (mobile) {
    const button = page
      .getByRole('navigation', { name: '主要页面' })
      .getByRole('button', { name: title, exact: true });
    if (await button.count()) await button.click();
    else {
      await page.getByRole('button', { name: '全部功能', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: title, exact: true }).click();
    }
  } else await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

async function databaseStates(page: Page, mobile: boolean, context: string) {
  await navigate(page, '考勤记录', mobile);
  if (mobile) {
    await expectReadable(
      page,
      '.page-content, .topbar, .mobile-navigation',
      `${context} records quick list`,
    );
    await page.getByRole('button', { name: '显示已撤销', exact: true }).click();
    await expectReadable(
      page,
      '.mobile-history-toolbar, .mobile-history-table',
      `${context} voided records`,
    );
    await page.getByRole('button', { name: '完整数据库', exact: true }).click();
  }
  await expectReadable(
    page,
    '.page-content, .topbar, .sidebar, .mobile-navigation',
    `${context} complete database`,
  );
  const tabs = page.getByRole('tablist', { name: '数据库视图' });
  const inactive = tabs.getByRole('tab', { selected: false }).first();
  await inactive.hover();
  await expectReadable(page, '.database-toolbar', `${context} unselected tab hover`);
  await tabs.getByRole('tab', { selected: true }).hover();
  await expectReadable(page, '.database-toolbar', `${context} selected tab hover`);
  const filter = page.getByRole('button', { name: '数据库筛选', exact: true });
  await filter.hover();
  await expectReadable(
    page,
    '.database-tools, .database-footer',
    `${context} toolbar hover and notes`,
  );
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expectReadable(page, '.ui-tooltip', `${context} toolbar tooltip`);
  await page.mouse.move(0, 0);
  await page.getByRole('textbox', { name: '搜索数据库', exact: true }).fill('不可能匹配的虚构内容');
  await expectReadable(
    page,
    '.database-toolbar, .database-body, .database-footer',
    `${context} empty search and placeholder`,
  );
  await page.getByRole('textbox', { name: '搜索数据库', exact: true }).clear();
  if (mobile) await page.getByRole('button', { name: '便捷列表', exact: true }).click();
}

for (const mobile of [true, false]) {
  test(`all eighteen themes in light and dark protect ${mobile ? 'phone' : 'desktop'} database text at high glass transparency`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await prepare(page, mobile);
    let modes = 0;
    for (const builtin of builtinThemes) {
      for (const mode of ['light', 'dark'] as const) {
        const context = `${builtin.definition.id}/${mode}`;
        await test.step(context, async () => {
          await appearance(page, builtin.definition.id, mode);
          await databaseStates(page, mobile, context);
          modes++;
        });
      }
    }
    expect(modes).toBe(36);
    await page.screenshot({
      path: testInfo.outputPath(`${mobile ? 'phone' : 'desktop'}-last-theme.png`),
    });
  });
}

async function extremeWallpapers(page: Page) {
  return page.evaluate(() =>
    ['black', 'white', 'mosaic'].map((kind) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 120;
      const context = canvas.getContext('2d')!;
      context.fillStyle = kind === 'black' ? '#000' : '#fff';
      context.fillRect(0, 0, 160, 120);
      if (kind === 'mosaic') {
        const colors = ['#fff', '#000', '#f00', '#0f0', '#00f', '#ff0'];
        for (let y = 0; y < 12; y++)
          for (let x = 0; x < 16; x++) {
            context.fillStyle = colors[(x + y * 3) % colors.length];
            context.fillRect(x * 10, y * 10, 10, 10);
          }
      }
      return { kind, data: canvas.toDataURL('image/webp') };
    }),
  );
}

test('classic and extreme custom wallpapers keep all phone pages, dialogs and status text readable', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await prepare(page, true);
  const wallpapers = await extremeWallpapers(page);
  for (const mode of ['light', 'dark'] as const) {
    for (const sample of [{ kind: 'classic', data: '' }, ...wallpapers]) {
      const context = `${sample.kind}/${mode}`;
      await appearance(page, sample.data ? 'custom' : 'classic', mode, sample.data || undefined);
      for (const title of [
        '课程表',
        '考勤工作台',
        '学生数据库',
        '考勤记录',
        '考勤汇总',
        '数据与备份',
        '设置与偏好',
      ]) {
        await navigate(page, title, true);
        await expectReadable(
          page,
          '.page-content, .topbar, .mobile-navigation',
          `${context} ${title}`,
        );
        if (title === '课程表') {
          await page.getByRole('button', { name: '添加课程', exact: true }).click();
          await expectReadable(page, '.modal', `${context} course dialog`);
          await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
        }
        if (title === '学生数据库') {
          await page
            .getByRole('textbox', { name: '搜索同学', exact: true })
            .fill('无匹配的虚构学生');
          await expectReadable(page, '.page-content', `${context} empty student list`);
          await page.getByRole('textbox', { name: '搜索同学', exact: true }).clear();
        }
        if (title === '考勤工作台') {
          await page.getByRole('button', { name: '虚构验收同学迟到加一', exact: true }).click();
          await expect(page.getByRole('status')).toContainText('已登记');
          await expectReadable(page, '.toast', `${context} saved toast`);
        }
        if (title === '设置与偏好') {
          const disabled = page.getByRole('button', { name: '添加', exact: true });
          await expect(disabled).toBeDisabled();
          await expectReadable(page, '.settings-form', `${context} disabled controls`);
          if (sample.kind === 'mosaic') {
            await page.getByRole('tab', { name: '外观与交互', exact: true }).click();
            await expectReadable(page, '.appearance-settings', `${context} appearance notes`);
            for (const preview of ['水墨江南', '经典主题']) {
              await page.getByRole('button', { name: `预览${preview}`, exact: true }).click();
              await page
                .getByRole('checkbox', { name: '预览深色', exact: true })
                .setChecked(mode === 'dark');
              await expectReadable(page, '.modal', `${context} local ${preview} preview`);
              await page
                .getByRole('dialog')
                .getByRole('button', { name: '取消', exact: true })
                .click();
            }
          }
        }
      }
      await databaseStates(page, true, context);
      if (sample.kind === 'mosaic')
        await page.screenshot({ path: testInfo.outputPath(`phone-mosaic-${mode}.png`) });
    }
  }
});

test('representative sky-hill phone reading surfaces remain composed in both modes', async ({
  page,
}, testInfo) => {
  await prepare(page, true);
  for (const mode of ['light', 'dark'] as const) {
    await appearance(page, 'sky-hill', mode);
    await navigate(page, '考勤记录', true);
    await expectReadable(
      page,
      '.page-content, .topbar, .mobile-navigation',
      `sky-hill/${mode} list`,
    );
    await page.screenshot({ path: testInfo.outputPath(`sky-hill-${mode}-records-list.png`) });
    await page.getByRole('button', { name: '完整数据库', exact: true }).click();
    await expectReadable(
      page,
      '.page-content, .topbar, .mobile-navigation',
      `sky-hill/${mode} database`,
    );
    await page.screenshot({ path: testInfo.outputPath(`sky-hill-${mode}-records-database.png`) });
    await page.getByRole('button', { name: '便捷列表', exact: true }).click();
  }
});
