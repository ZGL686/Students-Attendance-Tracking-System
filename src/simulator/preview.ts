import { mountApp } from '../app/bootstrap';
import { browserPreferenceKey } from '../browserEnvironment';
import { defaultPreferences, preferenceKey } from '../preferences/model';
import { createSimulatorData } from './demo';

function setInsets(top: number, bottom: number) {
  const root = document.documentElement;
  root.style.setProperty('--simulated-safe-area-top', `${Math.max(0, Math.min(80, top))}px`);
  root.style.setProperty('--simulated-safe-area-bottom', `${Math.max(0, Math.min(96, bottom))}px`);
}

setInsets(30, 48);
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  const message = event.data;
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'ludian-simulator-viewport' ||
    !('top' in message) ||
    !('bottom' in message) ||
    typeof message.top !== 'number' ||
    typeof message.bottom !== 'number' ||
    !Number.isFinite(message.top) ||
    !Number.isFinite(message.bottom)
  )
    return;
  setInsets(message.top, message.bottom);
});

try {
  const key = browserPreferenceKey(preferenceKey);
  if (localStorage.getItem(key) === null)
    localStorage.setItem(
      key,
      JSON.stringify({
        ...defaultPreferences,
        theme: 'light',
        themePackId: 'ink-jiangnan',
        themePackVersion: '1.0.0',
        visualThemeVersion: 1,
        glassTransparency: 18,
      }),
    );
} catch {
  // The application reports preference-storage errors through its normal UI.
}

mountApp(createSimulatorData);
