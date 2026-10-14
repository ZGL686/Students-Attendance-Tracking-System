import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/prepare-android-native.mjs', import.meta.url));
const templateRoot = fileURLToPath(new URL('../src-tauri/android/', import.meta.url));
const nativeFiles = ['MainActivity.kt', 'WorkerOfflineAssets.kt', 'WorkerOfflineAssetPolicy.kt'];
const mainRelative = 'src-tauri/gen/android/app/src/main/java/cn/guilu/attendance';
const temporaryRoot = path.resolve(os.tmpdir());
let root: string;
const cleanup: string[] = [];

async function write(relative: string, content: string | Buffer) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}
function run() {
  return spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
}
async function fresh() {
  const target = await fs.mkdtemp(path.join(temporaryRoot, 'ludian-android-native-'));
  cleanup.push(target);
  return target;
}

beforeEach(async () => {
  root = await fresh();
  await write('src-tauri/tauri.conf.json', JSON.stringify({ identifier: 'cn.guilu.attendance' }));
  await write(
    'src-tauri/gen/android/app/build.gradle.kts',
    'namespace = "cn.guilu.attendance"\napplicationId = "cn.guilu.attendance"\n',
  );
  await write(`${mainRelative}/MainActivity.kt`, '// existing generated activity\n');
  for (const file of nativeFiles) {
    await write(`src-tauri/android/${file}`, await fs.readFile(path.join(templateRoot, file)));
  }
  await write(
    'src-tauri/android/test/WorkerOfflineAssetPolicyTest.kt',
    await fs.readFile(path.join(templateRoot, 'test/WorkerOfflineAssetPolicyTest.kt')),
  );
});

afterEach(async () => {
  for (const target of cleanup.splice(0)) {
    const relative = path.relative(temporaryRoot, path.resolve(target));
    if (
      !relative.startsWith('ludian-android-native-') ||
      path.isAbsolute(relative) ||
      relative.includes(path.sep)
    ) {
      throw new Error('Unexpected temporary test directory; refusing recursive removal.');
    }
    await fs.rm(target, { recursive: true, force: true });
  }
});

it('copies maintained main and JVM test templates and reports the preserved activity', async () => {
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('4 updated, 0 unchanged');
  expect(result.stdout).toContain('preserved existing contents');
  for (const file of nativeFiles) {
    expect(await fs.readFile(path.join(root, mainRelative, file))).toEqual(
      await fs.readFile(path.join(templateRoot, file)),
    );
  }
  expect(
    await fs.readFile(
      path.join(
        root,
        'src-tauri/gen/android/app/src/test/java/cn/guilu/attendance/WorkerOfflineAssetPolicyTest.kt',
      ),
    ),
  ).toEqual(await fs.readFile(path.join(templateRoot, 'test/WorkerOfflineAssetPolicyTest.kt')));
  const backupRoot = path.join(root, '.local/android-native-backup');
  const hashes = await fs.readdir(backupRoot);
  expect(hashes).toHaveLength(1);
  expect(await fs.readFile(path.join(backupRoot, hashes[0], 'MainActivity.kt'), 'utf8')).toBe(
    '// existing generated activity\n',
  );
});

it('does not rewrite matching templates or create additional backups on repeated runs', async () => {
  expect(run().status).toBe(0);
  const activity = path.join(root, mainRelative, 'MainActivity.kt');
  const fixedTime = new Date('2001-01-01T00:00:00Z');
  await fs.utimes(activity, fixedTime, fixedTime);
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('0 updated, 4 unchanged');
  expect(result.stdout).not.toContain('preserved existing contents');
  expect((await fs.stat(activity)).mtimeMs).toBe(fixedTime.getTime());
  expect(await fs.readdir(path.join(root, '.local/android-native-backup'))).toHaveLength(1);
});

it('preserves subsequent generated edits before restoring the maintained template', async () => {
  expect(run().status).toBe(0);
  await write(`${mainRelative}/MainActivity.kt`, '// a later local activity customization\n');
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('1 updated, 3 unchanged');
  const backupRoot = path.join(root, '.local/android-native-backup');
  const texts = await Promise.all(
    (await fs.readdir(backupRoot)).map((hash) =>
      fs.readFile(path.join(backupRoot, hash, 'MainActivity.kt'), 'utf8'),
    ),
  );
  expect(texts).toContain('// a later local activity customization\n');
});

it('rejects a changed app identifier before changing generated files', async () => {
  await write('src-tauri/tauri.conf.json', JSON.stringify({ identifier: 'another.app' }));
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Android identifier must remain cn.guilu.attendance');
  expect(await fs.readFile(path.join(root, mainRelative, 'MainActivity.kt'), 'utf8')).toBe(
    '// existing generated activity\n',
  );
});

it('rejects a generated Android applicationId mismatch', async () => {
  await write(
    'src-tauri/gen/android/app/build.gradle.kts',
    'namespace = "cn.guilu.attendance"\napplicationId = "another.app"\n',
  );
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    'Generated Android applicationId must remain cn.guilu.attendance',
  );
});

it('does not accept a commented applicationId as the actual generated declaration', async () => {
  await write(
    'src-tauri/gen/android/app/build.gradle.kts',
    'namespace = "cn.guilu.attendance"\n// applicationId = "cn.guilu.attendance"\napplicationId = "another.app"\n',
  );
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    'Generated Android applicationId must remain cn.guilu.attendance',
  );
});

it('reports an uninitialized Android project instead of creating one', async () => {
  await fs.unlink(path.join(root, mainRelative, 'MainActivity.kt'));
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Run npm run android:init first');
  await expect(fs.stat(path.join(root, '.local'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('checks all template packages before writing any generated files', async () => {
  await write('src-tauri/android/WorkerOfflineAssetPolicy.kt', 'package another.app\n');
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('unexpected package');
  expect(await fs.readFile(path.join(root, mainRelative, 'MainActivity.kt'), 'utf8')).toBe(
    '// existing generated activity\n',
  );
});

it('refuses an Android generated directory junction outside the project', async () => {
  const otherRoot = await fresh();
  await fs.rename(path.join(root, 'src-tauri/gen/android'), path.join(otherRoot, 'android'));
  await fs.symlink(
    path.join(otherRoot, 'android'),
    path.join(root, 'src-tauri/gen/android'),
    'junction',
  );
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('refuses symbolic link');
  expect(
    await fs.readFile(
      path.join(otherRoot, 'android/app/src/main/java/cn/guilu/attendance/MainActivity.kt'),
      'utf8',
    ),
  ).toBe('// existing generated activity\n');
});

it('prepares native templates before offline and frontend Android builds', async () => {
  const build = await fs.readFile(new URL('../scripts/build-android.mjs', import.meta.url), 'utf8');
  expect(build.indexOf('scripts/prepare-android-native.mjs')).toBeLessThan(
    build.indexOf('scripts/prepare-offline.mjs'),
  );
});
