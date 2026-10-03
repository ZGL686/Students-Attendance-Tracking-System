export const fontOptions = [
  {
    id: 'rounded',
    name: '柔和圆体',
    detail: '圆润、轻松 · 源自 975 圆体',
    family: 'Ludian Rounded',
  },
  {
    id: 'handwritten',
    name: '手写文楷',
    detail: '自然的书写感 · 源自霞鹜文楷',
    family: 'Ludian Hand',
  },
  { id: 'sans', name: '简洁黑体', detail: '清晰、规整 · Noto Sans SC', family: 'GuiLu Sans' },
  { id: 'system', name: '系统字体', detail: '使用电脑上的默认界面字体', family: 'system-ui' },
] as const;
export type FontId = (typeof fontOptions)[number]['id'];
export const themeOptions = [
  { id: 'system', name: '跟随系统', detail: '随系统自动切换' },
  { id: 'light', name: '浅色', detail: '明亮清晰' },
  { id: 'dark', name: '深色', detail: '柔和暗色' },
] as const;
export type ThemeId = (typeof themeOptions)[number]['id'];
export type Preferences = {
  version: 2;
  theme: ThemeId;
  themePackId: string;
  themePackVersion: string;
  font: FontId;
  fontSize: 14 | 15 | 16;
  motion: 'system' | 'reduced';
  sidebarCollapsed: boolean;
  wallpaper?: string;
  glassTransparency?: number;
};
export const defaultGlassTransparency = 14;
export const preferenceKey = 'ludian.preferences.v2';
export const legacyPreferenceKey = 'ludian.preferences.v1';
export const defaultPreferences: Preferences = {
  version: 2,
  theme: 'system',
  themePackId: 'classic',
  themePackVersion: '1.0.0',
  font: 'rounded',
  fontSize: 14,
  motion: 'system',
  sidebarCollapsed: false,
};

// Preferences never enter attendance snapshots or imports. Invalid fields fall
// back individually, so a malformed preference cannot prevent opening records.
export function parsePreferences(raw: string | null): Preferences {
  try {
    const p: unknown = JSON.parse(raw ?? 'null');
    if (!p || typeof p !== 'object' || !('version' in p) || (p.version !== 1 && p.version !== 2))
      return { ...defaultPreferences };
    const value = p as Record<string, unknown>;
    return {
      version: 2,
      theme: themeOptions.some((t) => t.id === value.theme) ? (value.theme as ThemeId) : 'system',
      themePackId:
        value.version === 2 &&
        typeof value.themePackId === 'string' &&
        /^[a-z][a-z0-9-]{0,63}$/.test(value.themePackId)
          ? value.themePackId
          : 'classic',
      themePackVersion:
        value.version === 2 &&
        typeof value.themePackVersion === 'string' &&
        /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.themePackVersion)
          ? value.themePackVersion
          : '1.0.0',
      font: fontOptions.some((f) => f.id === value.font)
        ? (value.font as FontId)
        : defaultPreferences.font,
      fontSize: [14, 15, 16].includes(value.fontSize as number)
        ? (value.fontSize as Preferences['fontSize'])
        : 14,
      motion: value.motion === 'reduced' ? 'reduced' : 'system',
      sidebarCollapsed: value.sidebarCollapsed === true,
      ...(typeof value.wallpaper === 'string' &&
      value.wallpaper.length <= 2_850_000 &&
      /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.wallpaper)
        ? { wallpaper: value.wallpaper }
        : {}),
      ...(typeof value.glassTransparency === 'number' &&
      Number.isInteger(value.glassTransparency) &&
      value.glassTransparency >= 0 &&
      value.glassTransparency <= 30
        ? { glassTransparency: value.glassTransparency }
        : {}),
    };
  } catch {
    return { ...defaultPreferences };
  }
}
