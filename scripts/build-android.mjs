import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, LUDIAN_ANDROID_BUILD: '1' };

for (const args of [
  ['scripts/prepare-offline.mjs'],
  ['node_modules/typescript/bin/tsc', '-b'],
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.config.ts'],
]) {
  const result = spawnSync(
    process.execPath,
    args.map((part, index) => (index === 0 ? path.join(root, part) : part)),
    {
      cwd: root,
      env,
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
