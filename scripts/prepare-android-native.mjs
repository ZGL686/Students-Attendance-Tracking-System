import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identifier = 'cn.guilu.attendance';
const templates = ['MainActivity.kt', 'AppWindowInsets.kt', 'test/AppWindowInsetsTest.kt'];

function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

async function safePath(root, relative) {
  const target = path.resolve(root, relative);
  if (!isInside(root, target))
    throw new Error(`Android preparation path escapes project: ${relative}`);
  const parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error(`Android preparation refuses symbolic link: ${current}`);
  }
  return target;
}

async function existingFile(file) {
  return fs.readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

export async function prepareAndroidNative(rootPath = projectRoot, report = console.log) {
  const root = await fs.realpath(path.resolve(rootPath));
  const configPath = await safePath(root, 'src-tauri/tauri.conf.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (config.identifier !== identifier)
    throw new Error(`Android identifier must remain ${identifier}.`);
  const generated = 'src-tauri/gen/android';
  const mainRoot = `${generated}/app/src/main/java/${identifier.replaceAll('.', '/')}`;
  const testRoot = `${generated}/app/src/test/java/${identifier.replaceAll('.', '/')}`;
  const gradlePath = await safePath(root, `${generated}/app/build.gradle.kts`);
  const gradle = (await existingFile(gradlePath))?.toString('utf8');
  const mainActivity = await safePath(root, `${mainRoot}/MainActivity.kt`);
  if (!gradle || !(await existingFile(mainActivity))) {
    throw new Error('Android project is not initialized. Run npm run android:init first.');
  }
  for (const field of ['namespace', 'applicationId']) {
    const declarations = [
      ...gradle.matchAll(new RegExp(`^\\s*${field}\\s*=\\s*"([^"]+)"\\s*(?://.*)?$`, 'gm')),
    ];
    if (declarations.length !== 1 || declarations[0][1] !== identifier) {
      throw new Error(`Generated Android ${field} must remain ${identifier}.`);
    }
  }

  // Preflight every source and destination before changing generated files.
  const entries = [];
  for (const relative of templates) {
    const source = await safePath(root, `src-tauri/android/${relative}`);
    const bytes = await fs.readFile(source);
    if (!/^package cn\.guilu\.attendance\r?$/m.test(bytes.toString('utf8'))) {
      throw new Error(`Android template has an unexpected package: ${relative}`);
    }
    const destination = await safePath(
      root,
      `${relative.startsWith('test/') ? testRoot : mainRoot}/${path.basename(relative)}`,
    );
    entries.push({ relative, bytes, destination, existing: await existingFile(destination) });
  }
  // Only these maintained Worker files are obsolete. Never walk or remove the generated tree.
  const obsolete = [];
  for (const relative of [
    `${mainRoot}/WorkerOfflineAssets.kt`,
    `${mainRoot}/WorkerOfflineAssetPolicy.kt`,
    `${testRoot}/WorkerOfflineAssetPolicyTest.kt`,
  ]) {
    const destination = await safePath(root, relative);
    const existing = await existingFile(destination);
    if (existing) obsolete.push({ relative, destination, existing });
  }

  let changed = 0;
  const backups = [];
  const backupExisting = async (entry) => {
    if (entry.existing) {
      const hash = createHash('sha256').update(entry.existing).digest('hex');
      const backup = await safePath(
        root,
        `.local/android-native-backup/${hash}/${path.basename(entry.relative)}`,
      );
      await fs.mkdir(path.dirname(backup), { recursive: true });
      const prior = await existingFile(backup);
      if (prior && !prior.equals(entry.existing))
        throw new Error(`Android backup content does not match: ${backup}`);
      if (!prior) await fs.writeFile(backup, entry.existing, { flag: 'wx' });
      backups.push(path.relative(root, backup));
      report(
        `Android native file differs; preserved existing contents at ${path.relative(root, backup)}`,
      );
    }
  };
  // Preserve every changed/obsolete file before making any generated source changes.
  for (const entry of entries) {
    if (!entry.existing?.equals(entry.bytes)) await backupExisting(entry);
  }
  for (const entry of obsolete) await backupExisting(entry);
  for (const entry of entries) {
    if (entry.existing?.equals(entry.bytes)) continue;
    await fs.mkdir(path.dirname(entry.destination), { recursive: true });
    await safePath(root, path.relative(root, entry.destination));
    await fs.writeFile(entry.destination, entry.bytes);
    changed += 1;
  }
  for (const entry of obsolete) {
    await safePath(root, path.relative(root, entry.destination));
    await fs.unlink(entry.destination);
  }
  report(
    `Android native templates ready (${changed} updated, ${entries.length - changed} unchanged, ${obsolete.length} obsolete Worker files removed).`,
  );
  return { changed, unchanged: entries.length - changed, removed: obsolete.length, backups };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--root')) {
    throw new Error('Usage: node scripts/prepare-android-native.mjs [--root project-directory]');
  }
  await prepareAndroidNative(args[1] ?? projectRoot);
}
