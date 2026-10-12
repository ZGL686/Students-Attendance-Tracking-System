import { isTauri } from '@tauri-apps/api/core';
import { browserPreferenceKey } from './browserEnvironment';

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
export const isTauriApp = isTauri();
const androidSetupKey = 'ludian.android-workspace-imported';

export function androidWorkspaceImported() {
  if (!isAndroid) return true;
  try {
    return localStorage.getItem(browserPreferenceKey(androidSetupKey)) === 'true';
  } catch {
    return false;
  }
}

export function markAndroidWorkspaceImported() {
  if (!isAndroid) return;
  try {
    localStorage.setItem(browserPreferenceKey(androidSetupKey), 'true');
  } catch {
    // A data import must still succeed when preference storage is unavailable.
  }
}
