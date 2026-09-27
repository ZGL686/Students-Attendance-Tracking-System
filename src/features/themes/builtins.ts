import type { BuiltinTheme, ThemeDefinition, ThemePalette } from './schema';
import { builtinThemeSchema } from './schema';
import { expandedThemes } from './expanded-builtins';

function palette(accent: string, soft: string, selected: string, dark: boolean): ThemePalette {
  return dark
    ? {
        surface: '#23272b',
        surfaceSoft: '#292e32',
        sidebar: '#1c2327',
        text: '#f0eee5',
        textSecondary: '#d0cec5',
        muted: '#afb8b6',
        line: '#3c474b',
        border: '#536065',
        accent,
        accentHover: '#dfd7bf',
        onAccent: '#18282a',
        selected,
        hover: '#364447',
      }
    : {
        surface: '#fffefa',
        surfaceSoft: soft,
        sidebar: soft,
        text: '#303b37',
        textSecondary: '#53615b',
        muted: '#65756d',
        line: '#dce3da',
        border: '#c8d4c9',
        accent,
        accentHover: '#385c53',
        onAccent: '#ffffff',
        selected,
        hover: soft,
      };
}
function pack(
  id: string,
  name: string,
  description: string,
  category: ThemeDefinition['category'],
  decoration: ThemeDefinition['decoration'],
  light: ThemePalette,
  dark: ThemePalette,
  radius: ThemeDefinition['radius'] = 'rounded',
): BuiltinTheme {
  return {
    definition: {
      id,
      name,
      description,
      category,
      decoration,
      light,
      dark,
      radius,
      version: '1.0.0',
      backgroundOpacity: 0.15,
    },
    imageUrl: `/themes/${id}.png`,
  };
}
export const builtinThemes: BuiltinTheme[] = [
  pack(
    'sky-hill',
    '青空之丘',
    '风吹过青草与云朵，把每一天放进温柔的晴空。',
    'ghibli',
    'clouds',
    palette('#3d7866', '#eef3e6', '#e1efe2', false),
    palette('#9acaba', '', '#304b46', true),
  ),
  pack(
    'forest-cottage',
    '森间小屋',
    '林间木屋、午后光影，安静地整理日常。',
    'ghibli',
    'leaves',
    { ...palette('#687742', '#f1efe1', '#e9edda', false), surface: '#fffdf5' },
    { ...palette('#c3cd95', '', '#414a32', true), sidebar: '#22251d' },
  ),
  pack(
    'sakura-campus',
    '樱色学园',
    '樱花与清透蓝天，为课表添上一点青春色彩。',
    'anime',
    'petals',
    { ...palette('#aa507e', '#fbedf2', '#f6dfea', false), text: '#463445', accentHover: '#8d3e68' },
    { ...palette('#eda6cc', '', '#50364c', true), sidebar: '#2a202d', surface: '#302733' },
  ),
  pack(
    'star-train',
    '星夜列车',
    '银河驶过窗边，在星光里记录今天的旅程。',
    'anime',
    'stars',
    { ...palette('#6654a2', '#efedf8', '#e6e1f6', false), accentHover: '#54418a' },
    { ...palette('#bbadf0', '', '#3c355b', true), sidebar: '#1c1c30', surface: '#25253a' },
    'soft',
  ),
  pack(
    'ink-jiangnan',
    '水墨江南',
    '烟雨、远山与留白，让界面像一页舒展的画卷。',
    'guoman',
    'ink',
    { ...palette('#546e71', '#f0f1eb', '#e0e8e5', false), surface: '#faf9f3', text: '#343c3d' },
    { ...palette('#acc9c6', '', '#334647', true), surface: '#272c2c', sidebar: '#202525' },
    'square',
  ),
  pack(
    'jade-mountains',
    '青山仙境',
    '石青与石绿交织，将山河层次融进清晰的日常。',
    'guoman',
    'jade',
    { ...palette('#287b78', '#e6f2ed', '#d6ebe2', false), text: '#234644', accentHover: '#216764' },
    { ...palette('#80d0bb', '', '#234c46', true), surface: '#1f302f', sidebar: '#182826' },
    'soft',
  ),
  ...expandedThemes,
].map((theme) => builtinThemeSchema.parse(theme));
export const themeCategories = {
  ghibli: '治愈动画',
  anime: '二次元',
  guoman: '国漫',
  nature: '自然',
  city: '城市',
  fantasy: '幻想',
} as const;
export function findBuiltinTheme(id: string): BuiltinTheme | null {
  return builtinThemes.find((theme) => theme.definition.id === id) ?? null;
}
