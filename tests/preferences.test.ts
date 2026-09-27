import { describe, expect, it } from 'vitest';
import { defaultPreferences, parsePreferences } from '../src/preferences/model';

describe('device preferences are safe to load before application data', () => {
  it.each(['system', 'light', 'dark'])('persists theme %s and rejects unknown themes', (theme) => {
    expect(parsePreferences(JSON.stringify({ version: 1, theme })).theme).toBe(theme);
    expect(parsePreferences(JSON.stringify({ version: 1, theme: 'invalid' })).theme).toBe('system');
  });
  it.each([null, '', '{broken', 'null', '[]', '{"version":99,"font":"handwritten"}'])(
    'uses defaults for unsupported input %s',
    (raw) => {
      expect(parsePreferences(raw)).toEqual(defaultPreferences);
    },
  );
  it('keeps valid fields when another field is corrupt', () => {
    expect(
      parsePreferences(
        JSON.stringify({
          version: 1,
          font: 'handwritten',
          fontSize: 999,
          motion: 'reduced',
          sidebarCollapsed: true,
        }),
      ),
    ).toEqual({
      ...defaultPreferences,
      font: 'handwritten',
      motion: 'reduced',
      sidebarCollapsed: true,
    });
  });
  it('rejects arbitrary CSS values and wrong field types', () => {
    expect(
      parsePreferences(
        JSON.stringify({
          version: 1,
          font: 'url(https://invalid)',
          fontSize: '16',
          motion: 'full',
          sidebarCollapsed: 'false',
        }),
      ),
    ).toEqual(defaultPreferences);
  });
  it('round trips all supported preferences without copying unknown fields', () => {
    const p = {
      version: 2,
      font: 'system',
      theme: 'dark',
      themePackId: 'sky-hill',
      themePackVersion: '1.2.0',
      fontSize: 16,
      motion: 'reduced',
      sidebarCollapsed: true,
    };
    expect(parsePreferences(JSON.stringify({ ...p, students: ['not a preference'] }))).toEqual(p);
  });
  it('migrates every v1 field while keeping the classic appearance', () => {
    const legacy = {
      version: 1,
      theme: 'dark',
      font: 'sans',
      fontSize: 16,
      motion: 'reduced',
      sidebarCollapsed: true,
    };
    expect(parsePreferences(JSON.stringify(legacy))).toEqual({
      ...legacy,
      version: 2,
      themePackId: 'classic',
      themePackVersion: '1.0.0',
    });
  });
  it('does not accept theme ids or versions as arbitrary CSS or paths', () => {
    expect(
      parsePreferences(
        JSON.stringify({
          version: 2,
          themePackId: '../../unsafe',
          themePackVersion: 'url(https://unsafe)',
        }),
      ),
    ).toEqual(defaultPreferences);
  });
});
