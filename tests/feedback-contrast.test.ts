import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinThemes } from '../src/features/themes/builtins';
import { themeStyles } from '../src/features/themes/runtime';

const stylesheet = (name: string) =>
  fs.readFileSync(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8');
const tokensCss = stylesheet('tokens');
const rules = (source: string) => [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
function rule(source: string, selector: string) {
  const match = rules(source).find((item) => item[1].trim() === selector);
  expect(match, selector).toBeDefined();
  return match![2];
}
function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
}
const light = tokens(rule(tokensCss, ':root'));
const dark = { ...light, ...tokens(rule(tokensCss, ":root[data-theme='dark']")) };
function luminance(color: string) {
  const hex = color.length === 4 ? `#${[...color.slice(1)].map((c) => c + c).join('')}` : color;
  const [r, g, b] = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('feedback text uses its own opaque color pairs', () => {
  const combinations = [
    ...[false, true].map((isDark) => ({
      name: `classic ${isDark ? 'dark' : 'light'}`,
      values: isDark ? dark : light,
    })),
    ...builtinThemes.flatMap((theme) =>
      [false, true].map((isDark) => ({
        name: `${theme.definition.id} ${isDark ? 'dark' : 'light'}`,
        values: {
          ...(isDark ? dark : light),
          ...themeStyles(theme, isDark),
        } as Record<string, string>,
      })),
    ),
  ];
  it.each(combinations)('$name keeps notifications, errors and tooltips readable', ({ values }) => {
    for (const [foreground, background] of [
      ['--on-toast', '--toast-bg'],
      ['--on-toast', '--toast-error'],
      ['--on-tooltip', '--tooltip-bg'],
      ['--disabled-text', '--disabled-surface'],
    ])
      expect(
        contrast(values[foreground], values[background]),
        `${foreground}/${background}`,
      ).toBeGreaterThanOrEqual(4.5);
  });

  it('does not reuse theme button ink for independent feedback surfaces', () => {
    expect(rule(stylesheet('overlays'), '.toast')).toContain('color: var(--on-toast)');
    expect(rule(stylesheet('interaction'), '.ui-tooltip')).toContain('color: var(--on-tooltip)');
    for (const theme of builtinThemes) {
      const styled = themeStyles(theme, true) as Record<string, string>;
      expect(styled['--on-toast']).toBeUndefined();
      expect(styled['--on-tooltip']).toBeUndefined();
    }
    const closeFeedback = rule(
      stylesheet('overlays'),
      '.toast > button:not(:disabled):is(:hover, :active)',
    );
    expect(closeFeedback).toContain('background: transparent');
    expect(closeFeedback).toContain('color: inherit');
  });

  it('keeps disabled action labels opaque without changing read-only data cells', () => {
    expect(rule(stylesheet('base'), 'button:disabled')).not.toMatch(/opacity\s*:/);
    const disabled = rule(stylesheet('base'), 'button:disabled:not(.cell-button)');
    expect(disabled).toContain('color: var(--disabled-text)');
    expect(disabled).toContain('background: var(--disabled-surface)');
    expect(disabled).not.toMatch(/opacity\s*:/);
    expect(rule(stylesheet('base'), 'button:disabled:not(.cell-button) *')).toContain(
      'color: inherit',
    );
  });

  it('marks voided and dragged records without fading their entire text container', () => {
    const attendance = stylesheet('attendance');
    expect(rule(attendance, '.voided')).toContain('border-bottom-style: dashed');
    expect(rule(attendance, '.voided')).not.toMatch(/opacity\s*:/);
    expect(attendance).toContain('.voided .mobile-history-record-cell > .tag');
    expect(rule(stylesheet('mobile'), '.mobile-history-card.voided > td')).toContain(
      'border-bottom-style: dashed',
    );
    expect(rule(stylesheet('interaction'), '.database-card.dragging')).not.toMatch(/opacity\s*:/);
  });
});
