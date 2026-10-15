import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtinThemes } from '../src/features/themes/builtins';
import { initializePreferences } from '../src/preferences/PreferencesProvider';
import {
  contrastRatio,
  deriveReadingAppearance,
  readableForeground,
  readablePalette,
  readingTextTokens,
  worstWallpaperContrast,
} from '../src/preferences/readability';
import type { ReadingAppearanceInput, ReadingColors } from '../src/preferences/readability';
import { preferenceKey } from '../src/preferences/model';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const darkStart = css.indexOf(":root[data-theme='dark']");
function compositePixel(
  surface: string,
  opacity: number,
  pixel: number,
  rounding: 'floor' | 'ceil',
) {
  const raw = surface.slice(1);
  const full = raw.length === 3 ? [...raw].map((part) => part + part).join('') : raw;
  const alpha = Math.round(opacity * 255) / 255;
  return `#${[0, 2, 4]
    .map((offset) =>
      Math[rounding](parseInt(full.slice(offset, offset + 2), 16) * alpha + pixel * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
function tokens(dark: boolean) {
  const parse = (text: string) =>
    Object.fromEntries(
      [...text.matchAll(/--([\w-]+):\s*(#[\da-f]{3,6});/gi)].map((match) => [match[1], match[2]]),
    );
  return { ...parse(css.slice(0, darkStart)), ...(dark ? parse(css.slice(darkStart)) : {}) };
}

function inputFor(
  values: Record<string, string>,
  wallpaper = true,
  transparency = 70,
): ReadingAppearanceInput {
  return {
    surface: values.surface,
    surfaces: [
      'surface',
      'surface-soft',
      'surface-today',
      'sidebar',
      'selected',
      'selected-soft',
      'selected-neutral',
      'hover',
      'hover-soft',
      'pressed',
    ].map((key) => values[key]),
    colors: Object.fromEntries(readingTextTokens.map((key) => [key, values[key]])) as ReadingColors,
    inkSurfaces: Object.fromEntries(
      ['purple', 'blue', 'pink', 'green', 'amber', 'teal'].map((key) => [
        `${key}-ink`,
        values[`${key}-tint`],
      ]),
    ),
    action: {
      hover: values['primary-hover'],
      pressed: values['primary-pressed'],
      onBlue: values['on-blue'],
      onAccent: values['on-accent'],
    },
    hasWallpaper: wallpaper,
    transparency,
  };
}

function paletteTokens(dark: boolean, index?: number) {
  const result = tokens(dark);
  if (index === undefined) return result;
  const theme = builtinThemes[index].definition;
  const palette = dark ? theme.dark : theme.light;
  for (const [source, targets] of Object.entries({
    surface: ['surface'],
    surfaceSoft: ['surface-soft', 'surface-today', 'selected-soft'],
    sidebar: ['sidebar'],
    text: ['text'],
    textSecondary: ['text-secondary'],
    muted: ['muted', 'subtle'],
    accent: ['blue'],
    accentHover: ['primary-hover', 'primary-pressed'],
    onAccent: ['on-blue', 'on-accent'],
    selected: ['selected', 'selected-neutral'],
    hover: ['hover', 'hover-soft', 'pressed'],
  }))
    for (const target of targets) result[target] = palette[source as keyof typeof palette];
  return result;
}

describe('automatic reading contrast', () => {
  it('uses WCAG sRGB contrast and supports current opaque CSS color formats', () => {
    expect(contrastRatio('#000', '#fff')).toBe(21);
    expect(contrastRatio('#fff', '#fff')).toBe(1);
    expect(contrastRatio('rgb(255, 255, 255)', 'rgba(0, 0, 0, 1)')).toBe(21);
    expect(() => contrastRatio('transparent', '#fff')).toThrow('opaque theme color');
  });

  it('catches interior gray wallpaper colors that black/white endpoint-only checks miss', () => {
    expect(worstWallpaperContrast('#767676', '#ffffff', 0)).toBe(1);
    expect(contrastRatio('#767676', '#000000')).toBeGreaterThan(4.5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5);
    expect(worstWallpaperContrast('#777777', '#ffffff', 1)).toBeCloseTo(
      contrastRatio('#777777', '#ffffff'),
    );
  });

  it('keeps already-readable colors and adjusts faint text without inventing preferences', () => {
    expect(readableForeground('#123456', ['#fff'])).toBe('#123456');
    const fixed = readableForeground('#aaa8a2', ['#ffffff', '#eeedea']);
    expect(contrastRatio(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed, '#eeedea')).toBeGreaterThanOrEqual(4.5);
    expect(() => readableForeground('#777777', ['#000000', '#ffffff'])).toThrow(
      'separate readable surfaces',
    );
  });

  it.each([false, true])('protects classic colors with wallpaper=%s and no wallpaper', (dark) => {
    const values = tokens(dark);
    for (const wallpaper of [false, true]) {
      for (const transparency of [0, 35, 70]) {
        const input = inputFor(values, wallpaper, transparency);
        const before = structuredClone(input);
        const result = deriveReadingAppearance(input);
        expect(input).toEqual(before);
        expect(result.opacity).toBeGreaterThanOrEqual(wallpaper ? 1 - transparency / 100 : 1);
        for (const [key, color] of Object.entries(result.colors)) {
          for (const background of input.surfaces)
            expect(
              contrastRatio(color, background),
              `${dark}/${key}/${background}`,
            ).toBeGreaterThanOrEqual(key === 'text' ? 7 : 4.5);
          expect(
            worstWallpaperContrast(color, values.surface, result.opacity),
            `${dark}/${key}`,
          ).toBeGreaterThanOrEqual(key === 'text' ? 7 : 4.5);
        }
        for (const foreground of [result.action.onBlue, result.action.onAccent])
          for (const background of [result.colors.blue, result.action.hover, result.action.pressed])
            expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(builtinThemes.map((theme, index) => [theme.definition.name, index] as const))(
    '%s protects all normal, auxiliary and functional text at every glass value',
    (_name, index) => {
      for (const dark of [false, true]) {
        const values = paletteTokens(dark, index);
        for (let transparency = 0; transparency <= 70; transparency++) {
          const input = inputFor(values, true, transparency);
          const result = deriveReadingAppearance(input);
          expect(result.forceSolid).toBe(false);
          expect(result.opacity * 255).toBeCloseTo(Math.round(result.opacity * 255));
          for (const key of readingTextTokens) {
            expect(
              worstWallpaperContrast(result.colors[key], input.surface, result.opacity),
              `${dark}/${transparency}/${key}`,
            ).toBeGreaterThanOrEqual(key === 'text' ? 7 : 4.5);
            for (const background of [
              ...input.surfaces,
              ...(input.inkSurfaces?.[key] ? [input.inkSurfaces[key]!] : []),
            ])
              expect(
                contrastRatio(result.colors[key], background),
                `${dark}/${key}/${background}`,
              ).toBeGreaterThanOrEqual(key === 'text' ? 7 : 4.5);
            // Include both channel-rounding directions, not only ideal floating
            // point alpha compositing, which can hide a 4.49 browser result.
            for (const pixel of [0, 128, 255])
              for (const rounding of ['floor', 'ceil'] as const)
                expect(
                  contrastRatio(
                    result.colors[key],
                    compositePixel(input.surface, result.opacity, pixel, rounding),
                  ),
                  `8bit/${dark}/${transparency}/${key}/${pixel}/${rounding}`,
                ).toBeGreaterThanOrEqual(key === 'text' ? 7 : 4.5);
          }
          for (const foreground of [result.action.onBlue, result.action.onAccent])
            for (const background of [
              result.colors.blue,
              result.action.hover,
              result.action.pressed,
            ])
              expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it('corrects every local preview palette without depending on document styles', () => {
    for (const theme of builtinThemes) {
      for (const original of [theme.definition.light, theme.definition.dark]) {
        const result = readablePalette(original);
        const backgrounds = [
          result.surface,
          result.surfaceSoft,
          result.sidebar,
          result.selected,
          result.hover,
        ];
        for (const field of ['text', 'textSecondary', 'muted', 'accent'] as const)
          for (const background of backgrounds)
            expect(contrastRatio(result[field], background)).toBeGreaterThanOrEqual(
              field === 'text' ? 7 : 4.5,
            );
        for (const background of [result.accent, result.accentHover])
          expect(contrastRatio(result.onAccent, background)).toBeGreaterThanOrEqual(4.5);
        expect(result).not.toBe(original);
      }
    }
  });

  it('uses an opaque fallback when future background palettes have incompatible polarities', () => {
    const input = inputFor(tokens(false));
    input.surfaces.push('#000000');
    const result = deriveReadingAppearance(input);
    expect(result.forceSolid).toBe(true);
    expect(result.opacity).toBe(1);
    for (const color of Object.values(result.colors))
      expect(contrastRatio(color, input.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

afterEach(() => vi.unstubAllGlobals());

it('clears derived inline colors before theme, brightness and wallpaper transitions', () => {
  const properties = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (key: string, value: string) => properties.set(key, value),
      removeProperty: (key: string) => properties.delete(key),
    },
  };
  let stored = JSON.stringify({
    version: 2,
    theme: 'light',
    themePackId: 'custom',
    visualThemeVersion: 1,
    wallpaper: 'data:image/webp;base64,UklGRg==',
    glassTransparency: 70,
  });
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === preferenceKey ? stored : null),
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (key: string) =>
      properties.get(key) ?? tokens(root.dataset.theme === 'dark')[key.slice(2)] ?? '',
  }));
  const original = initializePreferences();
  expect(original.glassTransparency).toBe(70);
  expect(properties.get('--glass-opacity')).toBe('0.3');
  expect(properties.get('--surface')).toContain('30%');
  expect(properties.get('--reading-surface')).toMatch(/^rgba\(/);
  const firstLight = properties.get('--text');
  stored = JSON.stringify({ version: 2, theme: 'dark', themePackId: 'sky-hill' });
  initializePreferences();
  expect(root.dataset.themePack).toBe('sky-hill');
  expect(properties.get('--text')).not.toBe(firstLight);
  stored = JSON.stringify({ version: 2, theme: 'light', themePackId: 'classic' });
  initializePreferences();
  expect(root.dataset.themePack).toBe('classic');
  expect(properties.get('--text')).toBe(firstLight);
  expect(properties.get('--surface-base')).toBe('#fff');
  expect(properties.get('--glass-opacity')).toBe('1');
  expect(root.dataset.visualBackground).toBeUndefined();
});
