import type { ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Preferences } from './model';
import { defaultPreferences, legacyPreferenceKey, parsePreferences, preferenceKey } from './model';
import { findBuiltinTheme } from '../features/themes/builtins';
import { applyThemePack } from '../features/themes/runtime';

function apply(p: Preferences) {
  const root = document.documentElement;
  root.dataset.font = p.font;
  root.dataset.motion = p.motion;
  root.dataset.theme =
    p.theme === 'system'
      ? matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : p.theme;
  root.style.setProperty('--base-font-size', `${p.fontSize}px`);
  applyThemePack(findBuiltinTheme(p.themePackId), root.dataset.theme === 'dark');
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
