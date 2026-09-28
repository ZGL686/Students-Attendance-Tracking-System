import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const androidBuild = process.env.LUDIAN_ANDROID_BUILD === '1';

function optimizedPublicAssets() {
  return {
    name: 'ludian-public-assets',
    apply: 'build' as const,
    async closeBundle() {
      const source = path.join(root, 'public');
      const output = path.join(root, 'web-dist');
      await fs.cp(source, output, {
        recursive: true,
        filter: (entry) => {
          const relative = path.relative(source, entry);
          const first = relative.split(path.sep)[0];
          const isOfflineAsset = androidBuild && first === 'offline';
          const isUnoptimizedTheme =
            first === 'themes' && path.extname(entry).toLowerCase() === '.png';
          return relative === '' || (!isOfflineAsset && !isUnoptimizedTheme);
        },
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'build' ? [optimizedPublicAssets()] : [])],
  publicDir: command === 'build' ? false : 'public',
  resolve: {
    alias: androidBuild
      ? [
          {
            find: './features/timetable-import/ImportCourses',
            replacement: path.join(root, 'src/features/timetable-import/ImportCourses.android.tsx'),
          },
        ]
      : [],
  },
  clearScreen: false,
  build: { outDir: 'web-dist', chunkSizeWarningLimit: 1100 },
  server: {
    host: '127.0.0.1',
    port: 15473,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/.local/**', '**/dist/**', '**/wiki_memory/**'] },
  },
}));
