import type { CSSProperties } from 'react';
import type { BuiltinTheme, ThemePalette } from './schema';

const tokenMap: Record<keyof ThemePalette, string[]> = {
  surface: ['surface'],
  surfaceSoft: ['surface-soft', 'surface-today', 'selected-soft'],
  sidebar: ['sidebar'],
  text: ['text'],
  textSecondary: ['text-secondary'],
  muted: ['muted', 'subtle'],
  line: ['line'],
  border: ['border', 'border-strong', 'selected-border'],
  accent: ['blue'],
  accentHover: ['primary-hover', 'primary-pressed'],
  onAccent: ['on-blue', 'on-accent'],
  selected: ['selected', 'selected-neutral'],
  hover: ['hover', 'hover-soft', 'pressed'],
};
export function themeStyles(theme: BuiltinTheme, dark: boolean): CSSProperties {
  const definition = theme.definition;
  const palette = dark ? definition.dark : definition.light;
  const style: Record<string, string> = {};
  for (const key of Object.keys(tokenMap) as (keyof ThemePalette)[])
    for (const token of tokenMap[key]) style[`--${token}`] = palette[key];
  style['--focus-ring'] = `${palette.accent}45`;
  style['--pack-image'] = `url("${theme.imageUrl}")`;
  style['--pack-opacity'] = String(definition.backgroundOpacity);
  style['--pack-radius'] =
    definition.radius === 'rounded' ? '16px' : definition.radius === 'soft' ? '10px' : '4px';
  return style as CSSProperties;
}
const applied = new Set<string>();
export function applyThemePack(theme: BuiltinTheme | null, dark: boolean) {
  const root = document.documentElement;
  for (const property of applied) root.style.removeProperty(property);
  applied.clear();
  root.dataset.themePack = theme?.definition.id ?? 'classic';
  root.dataset.decoration = theme?.definition.decoration ?? 'none';
  if (!theme) return;
  for (const [property, value] of Object.entries(themeStyles(theme, dark))) {
    root.style.setProperty(property, String(value));
    applied.add(property);
  }
}
