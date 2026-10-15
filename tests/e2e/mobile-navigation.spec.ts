import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const pages = ['课程表', '考勤工作台', '学生数据库', '考勤记录', '数据与备份'];

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function expectUsableNavigation(page: Page) {
  const navigation = page.getByRole('navigation', { name: '主要页面', exact: true });
  await expect(navigation.getByRole('button')).toHaveCount(5);
  const measurements = await navigation.evaluate((element) => {
    const rect = (item: Element) => {
      const box = item.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom };
    };
    const bar = getComputedStyle(element);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      navigation: rect(element),
      background: bar.backgroundColor,
      opacity: bar.opacity,
      bottomPadding: Number.parseFloat(bar.paddingBottom),
      scrollWidth: document.documentElement.scrollWidth,
      buttons: Array.from(element.querySelectorAll('button')).map((button) => {
        const label = button.querySelector('span')!;
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        return {
          ...rect(button),
          label: rect(label),
          color: getComputedStyle(label).color,
          background:
            style.backgroundColor === 'rgba(0, 0, 0, 0)'
              ? bar.backgroundColor
              : style.backgroundColor,
          font: Number.parseFloat(style.fontSize),
          textFits:
            label.scrollWidth <= label.clientWidth + 1 &&
            label.scrollHeight <= label.clientHeight + 1,
          hitTarget: button.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          ),
        };
      }),
    };
  });
  expect(measurements.opacity).toBe('1');
  expect(measurements.background).toMatch(/^rgb\(/);
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.viewport.width);
  expect(measurements.navigation.bottom).toBeLessThanOrEqual(measurements.viewport.height + 1);
  // Native system-bar padding has already reduced this viewport. CSS adds only its own 6 px.
  expect(measurements.bottomPadding).toBe(6);
  for (const button of measurements.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(52);
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.font).toBeGreaterThanOrEqual(12);
    expect(button.textFits).toBe(true);
    expect(button.hitTarget).toBe(true);
    expect(button.label.x).toBeGreaterThanOrEqual(button.x);
    expect(button.label.x + button.label.width).toBeLessThanOrEqual(button.x + button.width);
    expect(button.label.bottom).toBeLessThanOrEqual(button.bottom);
    expect(button.bottom).toBeLessThanOrEqual(measurements.viewport.height - 6);
    expect(contrast(button.color, button.background)).toBeGreaterThanOrEqual(4.5);
  }
  const content = await page.locator('.main-scroll').evaluate((scroll) => {
    scroll.scrollTop = scroll.scrollHeight;
    return {
      bottom: scroll.lastElementChild!.getBoundingClientRect().bottom,
      mainBottom: scroll.getBoundingClientRect().bottom,
      navTop: document.querySelector('.mobile-navigation')!.getBoundingClientRect().top,
    };
  });
  expect(content.mainBottom).toBeLessThanOrEqual(content.navTop + 1);
  expect(content.bottom).toBeLessThanOrEqual(content.navTop + 1);
}

for (const scenario of [
  { name: 'three-button portrait', width: 393, height: 780, font: 14, theme: 'light' },
  { name: 'gesture portrait', width: 393, height: 804, font: 16, theme: 'dark' },
  { name: 'large text narrow portrait', width: 320, height: 740, font: 32, theme: 'light' },
  { name: 'large text landscape', width: 780, height: 345, font: 32, theme: 'light' },
  { name: 'large text gesture landscape', width: 804, height: 369, font: 32, theme: 'dark' },
] as const) {
  test(`native-fitted ${scenario.name} keeps all five tabs readable and content above them`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN' });
    await page.addInitScript(
      ({ theme }) => {
        localStorage.setItem(
          'ludian.preferences.v2',
          JSON.stringify({
            version: 2,
            theme,
            themePackId: 'ink-jiangnan',
            themePackVersion: '1.0.0',
            font: 'system',
            fontSize: 16,
            glassTransparency: 80,
            motion: 'reduced',
            sidebarCollapsed: false,
          }),
        );
      },
      { theme: scenario.theme },
    );
    await page.route('**/local-seed.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ name: '虚构导航验收班', students: [] }),
      }),
    );
    await page.goto('/');
    // Android's native container supplies the viewport excluding status/navigation bars;
    // env insets are zero after native dispatch. These are browser layout checks only.
    await page.evaluate(
      (font) => document.documentElement.style.setProperty('--base-font-size', `${font}px`),
      scenario.font,
    );
    const nav = page.getByRole('navigation', { name: '主要页面', exact: true });
    for (const title of pages) {
      await nav.getByRole('button', { name: title, exact: true }).click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expectUsableNavigation(page);
    }
    await page.screenshot({
      path: testInfo.outputPath(`navigation-${scenario.theme}-${scenario.font}.png`),
    });
  });
}

test.use({
  userAgent:
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
});
