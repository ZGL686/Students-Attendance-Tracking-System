import { expect, test } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';

const phoneSelector = 'iframe[title="Ludian 手机预览"]';
const pages = [
  { label: '课表', title: '课程表' },
  { label: '考勤', title: '考勤工作台' },
  { label: '学生', title: '学生数据库' },
  { label: '记录', title: '考勤记录' },
  { label: '备份', title: '数据与备份' },
];

async function openPhone(page: Page) {
  await page.goto('/phone-simulator.html');
  await expect(page.frameLocator(phoneSelector).locator('.app-shell')).toHaveAttribute(
    'data-mobile',
    'true',
  );
  const element = await page.locator(phoneSelector).elementHandle();
  const frame = await element?.contentFrame();
  if (!frame) throw new Error('手机预览 iframe 未加载');
  return frame;
}

async function expectSafeNavigation(page: Page, frame: Frame, bottom: number) {
  const navigation = frame.getByRole('navigation', { name: '主要页面' });
  await expect(navigation.getByRole('button')).toHaveCount(5);
  await expect(navigation.locator('button > span')).toHaveText(pages.map((item) => item.label));
  await expect
    .poll(() =>
      frame.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--simulated-safe-area-bottom',
          ),
        ),
      ),
    )
    .toBe(bottom);
  for (const item of pages) {
    const button = navigation.getByRole('button', { name: item.title, exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator('svg')).toBeVisible();
    await expect(button.locator('span')).toBeVisible();
  }
  const measurements = await frame.evaluate(() => {
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      items: Array.from(document.querySelectorAll('.mobile-navigation button')).map((button) => {
        const label = button.querySelector('span')!;
        return {
          button: rect(button),
          icon: rect(button.querySelector('svg')!),
          label: rect(label),
          textFits:
            label.scrollWidth <= label.clientWidth && label.scrollHeight <= label.clientHeight,
        };
      }),
    };
  });
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width);
  for (const [index, item] of measurements.items.entries()) {
    expect(item.textFits).toBe(true);
    for (const box of [item.button, item.icon, item.label]) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(measurements.width);
      expect(box.right).toBeGreaterThan(box.left);
      expect(box.bottom).toBeGreaterThan(box.top);
      expect(box.bottom).toBeLessThanOrEqual(measurements.height - bottom);
    }
    for (const box of [item.icon, item.label]) {
      expect(box.left).toBeGreaterThanOrEqual(item.button.left);
      expect(box.right).toBeLessThanOrEqual(item.button.right);
      expect(box.top).toBeGreaterThanOrEqual(item.button.top);
      expect(box.bottom).toBeLessThanOrEqual(item.button.bottom);
    }
    expect(measurements.height - item.button.bottom).toBeGreaterThanOrEqual(bottom + 5);
    if (index > 0)
      expect(measurements.items[index - 1].button.right).toBeLessThanOrEqual(item.button.left + 1);
  }
  const screen = await page.locator(phoneSelector).boundingBox();
  const system = await page.getByTestId('system-navigation').boundingBox();
  expect(screen).not.toBeNull();
  expect(system).not.toBeNull();
  const scale = screen!.height / measurements.height;
  expect(Math.abs(system!.height - bottom * scale)).toBeLessThanOrEqual(1);
  for (const item of measurements.items)
    expect(screen!.y + item.button.bottom * scale).toBeLessThanOrEqual(system!.y + 1);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/local-seed.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ name: '虚构模拟验收班', students: [] }),
    }),
  );
});

test('REDMI preview opens the real course workspace with five complete navigation items', async ({
  page,
}, testInfo) => {
  const frame = await openPhone(page);
  await expect(frame.getByRole('heading', { name: '课程表', exact: true })).toBeVisible();
  await expect(frame.locator('html')).toHaveAttribute('data-theme-pack', 'ink-jiangnan');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(frame.locator('.phone-calendar-scroll .course-card').first()).toBeVisible();
  expect(await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width: 400,
    height: 866,
  });
  expect(
    await frame.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--simulated-safe-area-top')
        .trim(),
    ),
  ).toBe('30px');
  await expect(page.getByLabel('系统导航', { exact: true })).toHaveValue('buttons');
  await expectSafeNavigation(page, frame, 48);
  await page.screenshot({ path: testInfo.outputPath('redmi-three-buttons.png'), fullPage: true });
});

test('switching to gestures changes the real app safe inset and leaves labels above the system bar', async ({
  page,
}, testInfo) => {
  const frame = await openPhone(page);
  await expectSafeNavigation(page, frame, 48);
  await page.getByLabel('系统导航', { exact: true }).selectOption('gesture');
  await expectSafeNavigation(page, frame, 24);
  await page.screenshot({ path: testInfo.outputPath('redmi-gesture.png'), fullPage: true });
  await page.getByLabel('系统导航', { exact: true }).selectOption('buttons');
  await expectSafeNavigation(page, frame, 48);
});

test('all five tabs navigate the real app and retain an unobstructed bottom bar', async ({
  page,
}) => {
  const frame = await openPhone(page);
  const navigation = frame.getByRole('navigation', { name: '主要页面' });
  for (const item of pages) {
    const button = navigation.getByRole('button', { name: item.title, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(frame.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
    await expectSafeNavigation(page, frame, 48);
  }
});

for (const width of [320, 360, 400, 430]) {
  test(`preview at ${width}px preserves complete navigation and bounds after scrolling`, async ({
    page,
  }, testInfo) => {
    const frame = await openPhone(page);
    await page.getByLabel('屏幕宽度', { exact: true }).fill(String(width));
    await expect.poll(() => frame.evaluate(() => innerWidth)).toBe(width);
    await expectSafeNavigation(page, frame, 48);
    await frame.locator('.main-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expectSafeNavigation(page, frame, 48);
    await page.screenshot({ path: testInfo.outputPath(`phone-${width}px.png`), fullPage: true });
  });
}

test('height changes and landscape rotation update the viewport while retaining mobile navigation', async ({
  page,
}, testInfo) => {
  const frame = await openPhone(page);
  await page.getByLabel('屏幕高度', { exact: true }).fill('800');
  await expect.poll(() => frame.evaluate(() => innerHeight)).toBe(800);
  await expectSafeNavigation(page, frame, 48);
  await page.getByRole('button', { name: '旋转屏幕', exact: true }).click();
  await expect
    .poll(() => frame.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width: 800, height: 400 });
  await expect(frame.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
  await expectSafeNavigation(page, frame, 48);
  await page.screenshot({ path: testInfo.outputPath('phone-landscape.png'), fullPage: true });
  await page.getByRole('button', { name: '旋转屏幕', exact: true }).click();
  await expect
    .poll(() => frame.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual({ width: 400, height: 800 });
  await expectSafeNavigation(page, frame, 48);
});

test('a narrow host fits the complete phone and exposes simulator controls only when requested', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 480, height: 720 });
  const frame = await openPhone(page);
  const settings = page.getByRole('button', { name: '模拟设置', exact: true });
  const controls = page.locator('.simulator-controls');
  const fitsHost = async () => {
    const host = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    for (const element of [page.locator(phoneSelector), page.getByTestId('system-navigation')]) {
      const box = await element.boundingBox();
      if (
        !box ||
        box.x < 0 ||
        box.y < 0 ||
        box.x + box.width > host.width + 1 ||
        box.y + box.height > host.height + 1
      )
        return false;
    }
    return true;
  };
  await expect(settings).toBeVisible();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(controls).toBeHidden();
  await expect(page.getByLabel('屏幕宽度', { exact: true })).toBeHidden();
  await expect.poll(fitsHost).toBe(true);
  await expectSafeNavigation(page, frame, 48);
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await expect(controls).toBeVisible();
  await expect(page.getByLabel('屏幕宽度', { exact: true })).toBeVisible();
  await expect(page.getByLabel('系统导航', { exact: true })).toBeVisible();
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(controls).toBeHidden();
  await expect.poll(fitsHost).toBe(true);
  await expectSafeNavigation(page, frame, 48);
  await page.screenshot({ path: testInfo.outputPath('narrow-host.png'), fullPage: true });
});

test('100 percent mode keeps the phone origin reachable and bottom navigation operable by stage scrolling', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 480, height: 720 });
  const frame = await openPhone(page);
  const settings = page.getByRole('button', { name: '模拟设置', exact: true });
  const stage = page.getByRole('region', { name: '手机屏幕预览', exact: true });
  await settings.click();
  await page.getByRole('button', { name: '自动适应', exact: true }).click();
  await expect(page.getByRole('button', { name: '100% 尺寸', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await settings.click();
  await expect(page.locator('.simulator-controls')).toBeHidden();
  await stage.evaluate((element) => element.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect
    .poll(async () => {
      const area = await stage.boundingBox();
      const phone = await page.locator('.phone-device').boundingBox();
      return !!area && !!phone && phone.x >= area.x && phone.y >= area.y;
    })
    .toBe(true);
  expect(
    await stage.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })),
  ).toEqual({ top: 0, left: 0 });
  expect(await stage.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await stage.evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, left: 0, behavior: 'instant' }),
  );
  const navigation = frame.getByRole('navigation', { name: '主要页面' });
  await expectSafeNavigation(page, frame, 48);
  const area = await stage.boundingBox();
  expect(area).not.toBeNull();
  const targets = [
    page.getByTestId('system-navigation'),
    ...pages.map((item) => navigation.getByRole('button', { name: item.title, exact: true })),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(area!.x);
    expect(box!.y).toBeGreaterThanOrEqual(area!.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(area!.x + area!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(area!.y + area!.height);
  }
  for (const item of pages) {
    const button = navigation.getByRole('button', { name: item.title, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(frame.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('100-percent-scroll.png'), fullPage: true });
});

test('simulator edits persist in its own database without reading or changing ordinary app data', async ({
  page,
}) => {
  let frame = await openPhone(page);
  const sentinel = { revision: 999, payload: 'synthetic-isolation-marker', savedAt: '2026-10-12' };
  const preferenceSentinel = JSON.stringify({
    version: 2,
    theme: 'dark',
    themePackId: 'neon-city',
    themePackVersion: '1.0.0',
    font: 'system',
    fontSize: 16,
    motion: 'reduced',
    sidebarCollapsed: true,
  });
  await page.evaluate(
    async ({ marker, preferences }) => {
      localStorage.setItem('ludian.preferences.v2', preferences);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('guilu-attendance', 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore('snapshots', { keyPath: 'revision' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('snapshots', 'readwrite');
          transaction.objectStore('snapshots').put(marker);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { marker: sentinel, preferences: preferenceSentinel },
  );
  frame = await openPhone(page);
  await expect(frame.locator('html')).toHaveAttribute('data-theme-pack', 'ink-jiangnan');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await frame
    .getByRole('navigation')
    .getByRole('button', { name: '学生数据库', exact: true })
    .click();
  await frame.getByRole('button', { name: '添加学生', exact: true }).click();
  await frame.getByLabel('姓名', { exact: true }).fill('虚构隔离验收同学');
  await frame.getByLabel('学号', { exact: true }).fill('SIMULATOR-TEST-001');
  await frame.getByRole('button', { name: '添加同学', exact: true }).click();
  await expect(frame.locator('.mobile-lookup-list')).toContainText('虚构隔离验收同学');
  frame = await openPhone(page);
  await expect(frame.locator('html')).toHaveAttribute('data-theme-pack', 'ink-jiangnan');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await frame
    .getByRole('navigation')
    .getByRole('button', { name: '学生数据库', exact: true })
    .click();
  await expect(frame.locator('.mobile-lookup-list')).toContainText('虚构隔离验收同学');
  const ordinaryData = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((database) => database.name);
    const marker = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open('guilu-attendance', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('snapshots').objectStore('snapshots').getAll();
        read.onsuccess = () => {
          database.close();
          resolve(read.result);
        };
        read.onerror = () => reject(read.error);
      };
    });
    return { names, marker, preferences: localStorage.getItem('ludian.preferences.v2') };
  });
  expect(ordinaryData.names).toContain('ludian-phone-simulator');
  expect(ordinaryData.marker).toEqual([sentinel]);
  expect(ordinaryData.preferences).toBe(preferenceSentinel);
});
