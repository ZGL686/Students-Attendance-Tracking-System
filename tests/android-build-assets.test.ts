import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import type { OutputBundle } from 'rollup';
import { assertAndroidTableBundle, shouldCopyPublicAsset } from '../vite.config';

const temporaryRoot = path.resolve(os.tmpdir());
const cleanup: string[] = [];

afterEach(async () => {
  for (const target of cleanup.splice(0)) {
    const relative = path.relative(temporaryRoot, path.resolve(target));
    if (!relative.startsWith('ludian-android-assets-') || relative.includes(path.sep))
      throw new Error('Unexpected temporary test directory; refusing recursive removal.');
    await fs.rm(target, { recursive: true, force: true });
  }
});

it('excludes the whole Android offline tree while retaining fonts, optimized themes and Excel files', () => {
  for (const relative of [
    'offline',
    'offline/ocr/worker.min.js',
    'offline/ocr/lang/chi_sim.traineddata.gz',
    'offline/ocr/core/tesseract-core.wasm',
    'offline/pdf/pdf.worker.min.mjs',
    'offline/licenses/pdfjs-dist/LICENSE',
    'offline\\assets.json',
  ])
    expect(shouldCopyPublicAsset(relative, true), relative).toBe(false);
  for (const relative of ['', 'fonts/regular.woff2', 'themes/forest.webp', '课程模板.xlsx'])
    expect(shouldCopyPublicAsset(relative, true), relative).toBe(true);
  expect(shouldCopyPublicAsset('themes/original.PNG', true)).toBe(false);
});

it('retains desktop and development recognition resources', () => {
  for (const relative of ['offline', 'offline/ocr/core/tesseract-core.wasm', 'offline/pdf/cmaps/a'])
    expect(shouldCopyPublicAsset(relative, false), relative).toBe(true);
  expect(shouldCopyPublicAsset('themes/original.png', false)).toBe(false);
});

function bundle(modules: string[]): OutputBundle {
  return {
    'app.js': {
      type: 'chunk',
      modules: Object.fromEntries(modules.map((id) => [id, {}])),
    },
  } as unknown as OutputBundle;
}

it('fails an Android build if any OCR or PDF module survives tree shaking', () => {
  for (const id of [
    '/project/node_modules/tesseract.js/src/index.js',
    '/project/node_modules/tesseract.js-core/tesseract-core.js',
    '/project/node_modules/pdfjs-dist/build/pdf.mjs',
    'D:\\project\\src\\features\\timetable-import\\readImages.ts',
    '/project/src/features/timetable-import/managed-ocr-worker.ts',
    '/project/src/features/timetable-import/readPdf.ts',
  ])
    expect(() => assertAndroidTableBundle(bundle([id])), id).toThrow(
      'still contains image/PDF code',
    );
  expect(() =>
    assertAndroidTableBundle(
      bundle([
        '/project/src/features/timetable-import/readExcel.ts',
        '/project/node_modules/exceljs/lib/exceljs.browser.js',
      ]),
    ),
  ).not.toThrow();
});

it('skips Android OCR preparation without dependencies and preserves existing public files', async () => {
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'ludian-android-assets-'));
  cleanup.push(root);
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'public/offline'), { recursive: true });
  const script = path.join(root, 'scripts/prepare-offline.mjs');
  await fs.copyFile(new URL('../scripts/prepare-offline.mjs', import.meta.url), script);
  const retained = path.join(root, 'public/offline/desktop-resource.txt');
  await fs.writeFile(retained, 'retained desktop resource');
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, LUDIAN_ANDROID_BUILD: '1' },
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('不准备 OCR / PDF');
  expect(await fs.readdir(path.join(root, 'public/offline'))).toEqual(['desktop-resource.txt']);
  expect(await fs.readFile(retained, 'utf8')).toBe('retained desktop resource');
});
