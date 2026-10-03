import type { ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Preferences } from './model';
import {
  defaultGlassTransparency,
  defaultPreferences,
  legacyPreferenceKey,
  parsePreferences,
  preferenceKey,
} from './model';
import { findBuiltinTheme } from '../features/themes/builtins';
import { applyThemePack } from '../features/themes/runtime';

function apply(p: Preferences) {
  const root = document.documentElement;
  for (const property of ['--surface', '--surface-soft', '--surface-today', '--sidebar'])
    root.style.removeProperty(property);
  root.dataset.font = p.font;
  root.dataset.motion = p.motion;
  root.dataset.theme =
    p.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : p.theme;
  root.style.setProperty('--base-font-size', `${p.fontSize}px`);
  const builtin = findBuiltinTheme(p.themePackId);
  applyThemePack(builtin, root.dataset.theme === 'dark');
  const background = p.themePackId === 'custom' ? p.wallpaper : builtin?.imageUrl;
  const palette = getComputedStyle(root);
  for (const [source, target] of [
    ['--surface', '--surface-base'],
    ['--surface-soft', '--surface-soft-base'],
    ['--surface-today', '--surface-today-base'],
    ['--sidebar', '--sidebar-base'],
  ]) {
    root.style.setProperty(target, palette.getPropertyValue(source).trim());
  }
  const hasWallpaper = !!background;
  const transparency = hasWallpaper ? (p.glassTransparency ?? defaultGlassTransparency) : 0;
  const surfaceColor = (base: string) =>
    hasWallpaper
      ? `color-mix(in srgb, var(${base}) ${100 - transparency}%, transparent)`
      : `var(${base})`;
  root.style.setProperty('--surface', surfaceColor('--surface-base'));
  root.style.setProperty('--surface-soft', surfaceColor('--surface-soft-base'));
  root.style.setProperty('--surface-today', surfaceColor('--surface-today-base'));
  root.style.setProperty('--sidebar', surfaceColor('--sidebar-base'));
  root.style.setProperty('--glass-opacity', String((100 - transparency) / 100));
  if (background) {
    root.dataset.visualBackground = 'true';
    root.style.setProperty('--user-wallpaper-image', `url("${background}")`);
    root.style.backgroundColor = 'transparent';
    root.style.backgroundImage = 'var(--user-wallpaper-image)';
    root.style.backgroundPosition = 'center';
    root.style.backgroundSize = 'cover';
    root.style.backgroundAttachment = 'fixed';
    root.style.backgroundRepeat = 'no-repeat';
  } else {
    delete root.dataset.visualBackground;
    root.style.removeProperty('--user-wallpaper-image');
    for (const property of [
      'background-color',
      'background-image',
      'background-position',
      'background-size',
      'background-attachment',
      'background-repeat',
    ])
      root.style.removeProperty(property);
  }
}
export function initializePreferences(): Preferences {
  let preferences = { ...defaultPreferences };
  try {
    const current = localStorage.getItem(preferenceKey);
    const legacy = current === null ? localStorage.getItem(legacyPreferenceKey) : null;
    preferences = parsePreferences(current ?? legacy);
    if (current === null && legacy !== null)
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    /* Session defaults remain usable when storage is unavailable. */
  }
  apply(preferences);
  return preferences;
}
type Value = {
  preferences: Preferences;
  setPreferences: (patch: Partial<Omit<Preferences, 'version'>>) => void;
  storageError: boolean;
};
const Context = createContext<Value | null>(null);
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider is required');
  return value;
}
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, set] = useState(initializePreferences);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (isTauri())
      void getCurrentWindow()
        .setTheme(preferences.theme === 'system' ? null : preferences.theme)
        .catch((error: unknown) => console.warn('窗口主题未能同步', error));
  }, [preferences.theme]);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => apply(preferences);
    system.addEventListener('change', sync);
    sync();
    return () => system.removeEventListener('change', sync);
  }, [preferences]);
  function setPreferences(patch: Partial<Omit<Preferences, 'version'>>) {
    const next = parsePreferences(JSON.stringify({ ...preferences, ...patch }));
    apply(next);
    set(next);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  return (
    <Context.Provider value={{ preferences, setPreferences, storageError }}>
      {children}
    </Context.Provider>
  );
}
