import { isTauri } from '@tauri-apps/api/core';

export const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
export const isTauriApp = isTauri();
const androidSetupKey = 'ludian.android-workspace-imported';

export function androidWorkspaceImported() {
  if (!isAndroid) return true;
  try {
    return localStorage.getItem(androidSetupKey) === 'true';
  } catch {
    return false;
  }
}

export function markAndroidWorkspaceImported() {
  if (!isAndroid) return;
  try {
    localStorage.setItem(androidSetupKey, 'true');
  } catch {
    // A data import must still succeed when preference storage is unavailable.
  }
}
