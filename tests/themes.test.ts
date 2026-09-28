import { describe, expect, it } from 'vitest';
import { builtinThemes, findBuiltinTheme, themeCategories } from '../src/features/themes/builtins';
import { builtinThemeSchema, themeDefinitionSchema } from '../src/features/themes/schema';
import { themeStyles } from '../src/features/themes/runtime';

function luminance(color: string) {
  const channels = [1, 3, 5]
    .map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
describe('bundled theme library', () => {
  it('contains eighteen distinct themes with local images and all six categories', () => {
    expect(builtinThemes).toHaveLength(18);
    expect(new Set(builtinThemes.map((theme) => theme.definition.id)).size).toBe(18);
    expect(new Set(builtinThemes.map((theme) => theme.definition.name)).size).toBe(18);
    for (const category of Object.keys(themeCategories))
      expect(builtinThemes.some((theme) => theme.definition.category === category)).toBe(true);
    for (const theme of builtinThemes) {
      expect(builtinThemeSchema.safeParse(theme).success).toBe(true);
      expect(theme.imageUrl).toBe(`/themes/${theme.definition.id}.webp`);
      expect(themeStyles(theme, false)).not.toEqual(themeStyles(theme, true));
    }
  });
  it.each(builtinThemes.map((theme) => [theme.definition.name, theme] as const))(
    '%s keeps readable text and action buttons in both modes',
    (_name, theme) => {
      for (const palette of [theme.definition.light, theme.definition.dark]) {
        expect(contrast(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.textSecondary, palette.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.muted, palette.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.textSecondary, palette.sidebar)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.onAccent, palette.accent)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
  it('keeps the original six ids and safely falls back for unavailable preferences', () => {
    for (const id of [
      'sky-hill',
      'forest-cottage',
      'sakura-campus',
      'star-train',
      'ink-jiangnan',
      'jade-mountains',
    ])
      expect(findBuiltinTheme(id)?.definition.id).toBe(id);
    expect(findBuiltinTheme('classic')).toBeNull();
    expect(findBuiltinTheme('missing-theme')).toBeNull();
  });
  it('validates only controlled built-in data and local image paths', () => {
    const original = builtinThemes[0];
    expect(
      themeDefinitionSchema.safeParse({ ...original.definition, css: 'body {display:none}' })
        .success,
    ).toBe(false);
    expect(
      themeDefinitionSchema.safeParse({
        ...original.definition,
        light: { ...original.definition.light, accent: 'url(https://invalid)' },
      }).success,
    ).toBe(false);
    expect(
      builtinThemeSchema.safeParse({ ...original, imageUrl: 'https://example.com/theme.webp' })
        .success,
    ).toBe(false);
    expect(
      builtinThemeSchema.safeParse({ ...original, imageUrl: '/themes/another-theme.webp' }).success,
    ).toBe(false);
  });
});
