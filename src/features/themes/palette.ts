import type { ThemePalette } from './schema';

function mix(first: string, second: string, ratio: number) {
  const channels = [1, 3, 5].map((offset) =>
    Math.round(
      parseInt(first.slice(offset, offset + 2), 16) * ratio +
        parseInt(second.slice(offset, offset + 2), 16) * (1 - ratio),
    )
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}
/** Theme hues tint surfaces, outlines and selections while text stays high contrast. */
export function tintedPalette(hue: string, accent: string, dark: boolean): ThemePalette {
  return dark
    ? {
        surface: mix(hue, '#181d27', 0.15),
        surfaceSoft: mix(hue, '#202735', 0.2),
        sidebar: mix(hue, '#111822', 0.1),
        text: '#f1f3f5',
        textSecondary: '#d0d8df',
        muted: '#aebfc9',
        line: mix(hue, '#364351', 0.3),
        border: mix(hue, '#536371', 0.3),
        accent,
        accentHover: mix(accent, '#ffffff', 0.8),
        onAccent: '#17232c',
        selected: mix(hue, '#263441', 0.3),
        hover: mix(hue, '#2f3d48', 0.22),
      }
    : {
        surface: mix(hue, '#ffffff', 0.035),
        surfaceSoft: mix(hue, '#ffffff', 0.08),
        sidebar: mix(hue, '#ffffff', 0.12),
        text: mix(hue, '#253039', 0.1),
        textSecondary: mix(hue, '#4b5960', 0.1),
        muted: mix(hue, '#5d6a71', 0.1),
        line: mix(hue, '#e4e8ea', 0.17),
        border: mix(hue, '#d6dce0', 0.23),
        accent,
        accentHover: mix(accent, '#182832', 0.8),
        onAccent: '#ffffff',
        selected: mix(hue, '#ffffff', 0.19),
        hover: mix(hue, '#ffffff', 0.11),
      };
}
