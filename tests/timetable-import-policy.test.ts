import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../src/platform');
  vi.doUnmock('../src/browserEnvironment');
  vi.doUnmock('../src/features/timetable-import/readImages');
  vi.doUnmock('../src/features/timetable-import/readPdf');
  vi.resetModules();
});

async function environment(android: boolean, preview = false) {
  vi.resetModules();
  vi.doMock('../src/platform', () => ({ isAndroid: android }));
  vi.doMock('../src/browserEnvironment', () => ({ isPhonePreview: preview }));
  return import('../src/features/timetable-import/import-policy');
}

describe('course import platform policy', () => {
  it.each([
    [true, false],
    [false, true],
  ])('uses fields-only input for Android=%s / phone preview=%s', async (android, preview) => {
    const policy = await environment(android, preview);
    expect(policy.tableImportOnly).toBe(true);
    expect(policy.courseImportAccept).toContain('.xlsx,.csv');
    expect(policy.courseImportAccept).not.toMatch(/image|pdf|png|jpg/);
    expect(policy.courseImportLabel).toBe('选择课表文件');
  });

  it('retains the existing desktop readers', async () => {
    const policy = await environment(false);
    expect(policy.tableImportOnly).toBe(false);
    expect(policy.courseImportAccept).toContain('image/*');
    expect(policy.courseImportAccept).toContain('.pdf');
  });

  it.each(['课表.png', '课表.pdf', '课表.xls', '其他.json'])(
    'rejects %s before loading any image or PDF reader on Android',
    async (name) => {
      await environment(true);
      const images = vi.fn();
      const pdf = vi.fn();
      vi.doMock('../src/features/timetable-import/readImages', () => ({ readImages: images }));
      vi.doMock('../src/features/timetable-import/readPdf', () => ({ readPdf: pdf }));
      const { readImportFiles } = await import('../src/features/timetable-import/read');
      await expect(readImportFiles([new File(['test'], name)])).rejects.toThrow(/xlsx|Excel/);
      expect(images).not.toHaveBeenCalled();
      expect(pdf).not.toHaveBeenCalled();
    },
  );
});
