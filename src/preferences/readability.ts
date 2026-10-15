type Rgb = [number, number, number];
export const readingContrastTarget = 4.65;
export const primaryReadingContrastTarget = 7.2;

export const readingTextTokens = [
  'text',
  'text-secondary',
  'muted',
  'subtle',
  'faint',
  'blue',
  'danger',
  'purple-ink',
  'blue-ink',
  'pink-ink',
  'green-ink',
  'amber-ink',
  'teal-ink',
] as const;
export type ReadingTextToken = (typeof readingTextTokens)[number];
export type ReadingColors = Record<ReadingTextToken, string>;
export type ReadingAppearanceInput = {
  surface: string;
  surfaces: string[];
  colors: ReadingColors;
  inkSurfaces?: Partial<Record<ReadingTextToken, string>>;
  action: { hover: string; pressed: string; onBlue: string; onAccent: string };
  hasWallpaper: boolean;
  transparency: number;
};

function rgb(color: string): Rgb {
  const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as Rgb;
  }
  const css = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+1)?\s*\)$/i);
  if (css) {
    const channels = css.slice(1, 4).map(Number);
    if (channels.every((value) => Number.isFinite(value) && value >= 0 && value <= 255))
      return channels as Rgb;
  }
  throw new Error(`Unsupported opaque theme color: ${color}`);
}

function hex(color: Rgb): string {
  return `#${color.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(color: Rgb): number {
  const channels = color.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function ratio(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function contrastRatio(foreground: string, background: string): number {
  return ratio(luminance(rgb(foreground)), luminance(rgb(background)));
}

function mix(first: Rgb, second: Rgb, amount: number): Rgb {
  return first.map((channel, index) => channel * (1 - amount) + second[index] * amount) as Rgb;
}

function weakestContrast(foreground: string, backgrounds: string[]): number {
  return Math.min(...backgrounds.map((background) => contrastRatio(foreground, background)));
}

/** Preserve the hue as far as possible, blending toward a readable black or white. */
export function readableForeground(
  foreground: string,
  backgrounds: string[],
  preferred = readingContrastTarget,
): string {
  const value = hex(rgb(foreground));
  const backgroundLuminances = backgrounds.map((background) => luminance(rgb(background)));
  const score = (color: string) => {
    const text = luminance(rgb(color));
    return Math.min(...backgroundLuminances.map((background) => ratio(text, background)));
  };
  if (score(value) >= preferred) return value;
  const endpoints = ['#000000', '#ffffff'].sort((first, second) => score(second) - score(first));
  const endpoint = endpoints[0];
  const possible = score(endpoint);
  if (possible < 4.5) throw new Error('Theme backgrounds require separate readable surfaces.');
  const target = Math.min(preferred, possible);
  let low = 0,
    high = 1;
  for (let iteration = 0; iteration < 28; iteration++) {
    const middle = (low + high) / 2;
    const candidate = hex(mix(rgb(value), rgb(endpoint), middle));
    if (score(candidate) >= target) high = middle;
    else low = middle;
  }
  return hex(mix(rgb(value), rgb(endpoint), high));
}

/** Every wallpaper pixel lies between the black/white composites per channel.
 * An interior foreground luminance can be matched by a gray pixel: endpoints
 * alone would miss that contrast can fall all the way to 1. */
export function worstWallpaperContrast(
  foreground: string,
  surface: string,
  opacity: number,
): number {
  const [minimum, maximum] = wallpaperRange(rgb(surface), opacity);
  return rangeContrast(luminance(rgb(foreground)), minimum, maximum);
}

function wallpaperRange(surface: Rgb, opacity: number): [number, number] {
  const alpha = Math.max(0, Math.min(1, opacity));
  return [
    luminance(mix([0, 0, 0], surface, alpha)),
    luminance(mix([255, 255, 255], surface, alpha)),
  ];
}

function rangeContrast(text: number, minimum: number, maximum: number): number {
  if (text >= minimum && text <= maximum) return 1;
  return Math.min(ratio(text, minimum), ratio(text, maximum));
}

type PaletteColors = {
  surface: string;
  surfaceSoft: string;
  sidebar: string;
  text: string;
  textSecondary: string;
  muted: string;
  accent: string;
  accentHover: string;
  onAccent: string;
  selected: string;
  hover: string;
};

/** Theme previews have a local palette and cannot inherit root corrections. */
export function readablePalette<T extends PaletteColors>(palette: T): T {
  const backgrounds = [
    palette.surface,
    palette.surfaceSoft,
    palette.sidebar,
    palette.selected,
    palette.hover,
  ];
  const accent = readableForeground(palette.accent, backgrounds);
  let accentHover = palette.accentHover;
  if (
    Math.max(
      weakestContrast('#000000', [accent, accentHover]),
      weakestContrast('#ffffff', [accent, accentHover]),
    ) < readingContrastTarget
  ) {
    const foreground = contrastRatio('#000000', accent) >= 4.5 ? '#000000' : '#ffffff';
    accentHover = readableForeground(accentHover, [foreground]);
  }
  return {
    ...palette,
    text: readableForeground(palette.text, backgrounds, primaryReadingContrastTarget),
    textSecondary: readableForeground(palette.textSecondary, backgrounds),
    muted: readableForeground(palette.muted, backgrounds),
    accent,
    accentHover,
    onAccent: readableForeground(palette.onAccent, [accent, accentHover]),
  };
}

export function deriveReadingAppearance(input: ReadingAppearanceInput) {
  const surface = hex(rgb(input.surface));
  const provided = [...new Set([surface, ...input.surfaces.map((value) => hex(rgb(value)))])];
  let backgrounds = provided;
  // Bundled palettes share a light/dark polarity. A contradictory future palette
  // falls back to one opaque background instead of silently losing readability.
  const canUseTogether = (values: string[]) =>
    Math.max(weakestContrast('#000000', values), weakestContrast('#ffffff', values)) >= 4.5;
  const allBackgrounds = [...provided, ...Object.values(input.inkSurfaces ?? {})];
  const forceSolid = !canUseTogether(allBackgrounds);
  if (forceSolid) backgrounds = [surface];
  const colors = {} as ReadingColors;
  for (const key of readingTextTokens) {
    const paired = input.inkSurfaces?.[key];
    colors[key] = readableForeground(
      input.colors[key],
      [...backgrounds, ...(!forceSolid && paired ? [paired] : [])],
      key === 'text' ? primaryReadingContrastTarget : readingContrastTarget,
    );
  }

  let opacity = input.hasWallpaper ? Math.max(0, Math.min(1, 1 - input.transparency / 100)) : 1;
  const targets = Object.fromEntries(
    readingTextTokens.map((key) => [
      key,
      Math.min(
        key === 'text' ? primaryReadingContrastTarget : readingContrastTarget,
        contrastRatio(colors[key], surface),
      ),
    ]),
  ) as Record<ReadingTextToken, number>;
  const base = rgb(surface);
  const textLuminances = Object.fromEntries(
    readingTextTokens.map((key) => [key, luminance(rgb(colors[key]))]),
  ) as Record<ReadingTextToken, number>;
  const safe = (alpha: number) => {
    const [minimum, maximum] = wallpaperRange(base, alpha);
    return readingTextTokens.every(
      (key) => rangeContrast(textLuminances[key], minimum, maximum) >= targets[key],
    );
  };
  if (forceSolid) opacity = 1;
  else if (!safe(opacity)) {
    let low = opacity,
      high = 1;
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = (low + high) / 2;
      if (safe(middle)) high = middle;
      else low = middle;
    }
    opacity = high;
  }
  // Browser compositing may quantize alpha to eight bits. Round upward and
  // retain the foreground margin instead of solving at the 4.5 boundary.
  opacity = Math.min(1, Math.ceil(opacity * 255) / 255);
  const actionBackgrounds = [colors.blue, input.action.hover, input.action.pressed];
  let hover = input.action.hover,
    pressed = input.action.pressed;
  if (!canUseTogether(actionBackgrounds)) {
    const foreground = contrastRatio('#000000', colors.blue) >= 4.5 ? '#000000' : '#ffffff';
    hover = readableForeground(hover, [foreground]);
    pressed = readableForeground(pressed, [foreground]);
  }
  const action = [colors.blue, hover, pressed];
  const channels = rgb(surface).map(Math.round);
  return {
    readingSurface: `rgba(${channels.join(', ')}, ${opacity})`,
    opacity,
    colors,
    action: {
      hover,
      pressed,
      onBlue: readableForeground(input.action.onBlue, action),
      onAccent: readableForeground(input.action.onAccent, action),
    },
    forceSolid,
  };
}
