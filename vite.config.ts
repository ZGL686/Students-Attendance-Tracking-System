import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

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

          const isUnoptimizedTheme =
            first === 'themes' && path.extname(entry).toLowerCase() === '.png';
          return relative === '' || !isUnoptimizedTheme;
        },
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === 'build' ? [optimizedPublicAssets()] : [])],
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
