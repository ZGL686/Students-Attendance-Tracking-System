import { defineConfig } from 'vite';
import type { OutputBundle } from 'rollup';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export function shouldCopyPublicAsset(relative: string, tableImportOnly: boolean) {
  const normalized = relative.replaceAll('\\', '/');
  const first = normalized.split('/')[0];
  if (tableImportOnly && first === 'offline') return false;
  return first !== 'themes' || path.extname(normalized).toLowerCase() !== '.png';
}

export function assertAndroidTableBundle(bundle: OutputBundle) {
  const forbidden = Object.values(bundle).flatMap((entry) => {
    if (entry.type !== 'chunk') return [];
    return Object.keys(entry.modules).filter((id) =>
      /(?:\/node_modules\/(?:tesseract\.js(?:-core)?|pdfjs-dist)\/|\/timetable-import\/(?:ocr|managed-ocr-worker|readImages|readCard|readPdf|image-canvas)\.ts(?:\?|$))/i.test(
        id.replaceAll('\\', '/'),
      ),
    );
  });
  if (forbidden.length)
    throw new Error(
      `Android table import build still contains image/PDF code: ${forbidden.join(', ')}`,
    );
}

function optimizedPublicAssets(tableImportOnly: boolean) {
  return {
    name: 'ludian-public-assets',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: OutputBundle) {
      if (tableImportOnly) assertAndroidTableBundle(bundle);
    },
    async closeBundle() {
      const source = path.join(root, 'public');
      const output = path.join(root, 'web-dist');
      await fs.cp(source, output, {
        recursive: true,
        filter: (entry) => {
          const relative = path.relative(source, entry);
          return shouldCopyPublicAsset(relative, tableImportOnly);
        },
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  define: {
    __LUDIAN_TABLE_IMPORT_ONLY__: JSON.stringify(process.env.LUDIAN_ANDROID_BUILD === '1'),
  },
  plugins: [
    react(),
    ...(command === 'build'
      ? [optimizedPublicAssets(process.env.LUDIAN_ANDROID_BUILD === '1')]
      : []),
  ],
  publicDir: command === 'build' ? false : 'public',
  clearScreen: false,
  build: { outDir: 'web-dist', chunkSizeWarningLimit: 1100 },
  server: {
    host: '127.0.0.1',
    port: 15473,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.local/**', '**/dist/**', '**/wiki_memory/**'] },
  },
}));
