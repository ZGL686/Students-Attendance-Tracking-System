import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const paletteSchema = z.strictObject({
  surface: color,
  surfaceSoft: color,
  sidebar: color,
  text: color,
  textSecondary: color,
  muted: color,
  line: color,
  border: color,
  accent: color,
  accentHover: color,
  onAccent: color,
  selected: color,
  hover: color,
});
/** Data checks for bundled artwork; no external theme packages are accepted. */
export const themeDefinitionSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .refine((id) => id !== 'classic'),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
  name: z.string().trim().min(1).max(32),
  description: z.string().trim().min(1).max(160),
  category: z.enum(['ghibli', 'anime', 'guoman', 'nature', 'city', 'fantasy']),
  light: paletteSchema,
  dark: paletteSchema,
  radius: z.enum(['soft', 'rounded', 'square']),
  decoration: z.enum([
    'clouds',
    'leaves',
    'petals',
    'stars',
    'ink',
    'jade',
    'waves',
    'sun',
    'snow',
    'neon',
    'orbit',
    'moon',
    'books',
    'lotus',
  ]),
  backgroundOpacity: z.number().min(0.03).max(0.3),
});
export const builtinThemeSchema = z
  .strictObject({
    definition: themeDefinitionSchema,
    imageUrl: z.string().regex(/^\/themes\/[a-z][a-z0-9-]*\.png$/),
  })
  .refine((theme) => theme.imageUrl === `/themes/${theme.definition.id}.png`);
export type ThemePalette = z.infer<typeof paletteSchema>;
export type ThemeDefinition = z.infer<typeof themeDefinitionSchema>;
export type BuiltinTheme = z.infer<typeof builtinThemeSchema>;
