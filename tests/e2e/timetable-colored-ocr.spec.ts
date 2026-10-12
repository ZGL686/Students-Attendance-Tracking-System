import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CourseCatalogEntry, ImportResult } from '../../src/features/timetable-import/model';
import {
  coloredTimetableFixtures,
  fictionalCards,
  fictionalCatalog,
} from './timetable-colored-fixture';

async function readImages(
  page: Page,
  images: { name: string; base64: string }[],
  catalog: CourseCatalogEntry[] = [],
): Promise<ImportResult> {
  return page.evaluate(
    async ({ images, catalog }) => {
      const path = '/src/features/timetable-import/read.ts';
      const { readImportFiles } = await import(path);
      const files = images.map(({ name, base64 }) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        return new File([bytes], name, {
          type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
        });
      });
      return readImportFiles(files, { catalog });
    },
    { images, catalog },
  );
}

function signature(result: ImportResult) {
  return result.drafts
    .map(({ name, day, start, end, room, weeks }) => ({ name, day, start, end, room, weeks }))
    .sort((a, b) => Number(a.day) - Number(b.day) || Number(a.start) - Number(b.start));
}

function expectComplete(result: ImportResult) {
  expect(result.catalog, JSON.stringify(result.catalog, null, 2)).toHaveLength(13);
  expect(result.catalog?.map(({ name, code }) => ({ name, code }))).toEqual(
    fictionalCatalog.map(({ name, code }) => ({ name, code })),
  );
  expect(result.drafts, JSON.stringify(result.drafts, null, 2)).toHaveLength(11);
  expect(
    new Set(result.drafts.map((draft) => draft.name)).size,
    JSON.stringify(result.drafts, null, 2),
  ).toBe(9);
  expect(signature(result), JSON.stringify(result.drafts, null, 2)).toEqual(
    fictionalCards.map((card) => ({ ...card, weeks: '' })),
  );
  expect(result.drafts.every((draft) => !draft.blockingIssues?.length)).toBe(true);
  expect(result.drafts.every((draft) => (draft.fieldConfidence?.name ?? 0) >= 75)).toBe(true);
  expect(result.drafts.some((draft) => draft.teacher === '测试老师')).toBe(true);
  for (const draft of result.drafts) {
    if (draft.teacher)
      expect(draft.teacher).toBe(
        fictionalCatalog.find((entry) => entry.name === draft.name)?.teacher,
      );
  }
}

test('offline colored OCR combines catalogs in either order and retains references for a scaled JPEG supplement', async ({
  page,
  context,
}) => {
  test.setTimeout(360_000);
  const remote: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') await route.continue();
    else {
      remote.push(url.origin);
      await route.abort();
    }
  });
  await context.route('**/local-seed.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  const fixture = await coloredTimetableFixtures(page);
  const catalog = { name: '虚构课程目录.png', base64: fixture.catalog };
  const timetable = { name: '虚构彩色课表.png', base64: fixture.timetable };
  const first = await test.step('catalog before timetable', () =>
    readImages(page, [catalog, timetable]));
  expectComplete(first);
  const reversed = await test.step('timetable before catalog', () =>
    readImages(page, [timetable, catalog]));
  expectComplete(reversed);
  expect(signature(reversed)).toEqual(signature(first));
  const reference = await test.step('catalog only does not invent scheduled courses', () =>
    readImages(page, [catalog]));
  expect(reference.catalog).toHaveLength(13);
  expect(reference.drafts).toEqual([]);
  const supplemented =
    await test.step('scaled compressed timetable supplements retained catalog', () =>
      readImages(
        page,
        [{ name: '虚构缩放压缩课表.jpg', base64: fixture.scaledTimetable }],
        reference.catalog,
      ));
  const diagnostic = test.info().outputPath('fictional-scaled-ocr.json');
  await mkdir(dirname(diagnostic), { recursive: true });
  await writeFile(diagnostic, JSON.stringify(supplemented, null, 2));
  await test.info().attach('fictional-scaled-ocr.json', {
    path: diagnostic,
    contentType: 'application/json',
  });
  expectComplete(supplemented);
  expect(remote).toEqual([]);
});
