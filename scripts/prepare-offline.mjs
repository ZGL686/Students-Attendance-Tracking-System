import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public', 'offline');
const packages = {
  'tesseract.js': '7.0.0',
  'tesseract.js-core': '7.0.0',
  'pdfjs-dist': '6.3.289',
  '@tesseract.js-data/chi_sim': '1.0.0',
  '@tesseract.js-data/eng': '1.0.0',
};
const files = [];
const notices = [
  'Ludian offline recognition dependencies',
  'Versions and licenses are copied from the installed, lockfile-pinned packages.',
];
async function copy(source, relative) {
  const bytes = await fs.readFile(source);
  const destination = path.join(output, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  // Avoid rewriting large WASM files when Vite restarts.
  const existing = await fs.readFile(destination).catch(() => null);
  if (!existing?.equals(bytes)) await fs.writeFile(destination, bytes);
  files.push({
    path: relative.replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
async function tree(source, relative) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const destination = path.join(relative, entry.name);
    if (entry.isDirectory()) await tree(path.join(source, entry.name), destination);
    else await copy(path.join(source, entry.name), destination);
  }
}
for (const [name, version] of Object.entries(packages)) {
  const folder = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  notices.push(
    `\n${name} ${version}\nLicense: ${pkg.license ?? 'See package metadata'}\n${pkg.homepage ?? ''}`,
  );
  if (pkg.version !== version) throw new Error(`离线资源版本不匹配：${name} 需要 ${version}。`);
  const licenseFolder = name.replaceAll('/', '_').replace('@', '');
  await copy(path.join(folder, 'package.json'), `licenses/${licenseFolder}/package.json`);
  for (const file of await fs.readdir(folder))
    if (/^(LICENSE|COPYING|NOTICE)(\.|$)/i.test(file)) {
      await copy(path.join(folder, file), `licenses/${licenseFolder}/${file}`);
      notices.push(await fs.readFile(path.join(folder, file), 'utf8'));
    }
}
await copy(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), 'ocr/worker.min.js');
const core = path.join(root, 'node_modules/tesseract.js-core');
for (const file of await fs.readdir(core))
  if (/^tesseract-core.*\.(js|wasm)$/.test(file))
    await copy(path.join(core, file), `ocr/core/${file}`);
for (const language of ['chi_sim', 'eng'])
  await copy(
    path.join(
      root,
      'node_modules/@tesseract.js-data',
      language,
      '4.0.0_best_int',
      `${language}.traineddata.gz`,
    ),
    `ocr/lang/${language}.traineddata.gz`,
  );
const pdf = path.join(root, 'node_modules/pdfjs-dist');
await copy(path.join(pdf, 'build/pdf.worker.min.mjs'), 'pdf/pdf.worker.min.mjs');
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs'])
  await tree(path.join(pdf, directory), `pdf/${directory}`);
files.sort((a, b) => a.path.localeCompare(b.path));
await fs.writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n') + '\n');
await fs.writeFile(
  path.join(output, 'assets.json'),
  JSON.stringify({ schemaVersion: 1, packages, files }, null, 2) + '\n',
);
console.log(
  `离线识别资源已就绪：${files.length} 个文件，${Math.round(files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024)} MB，无 CDN 依赖。`,
);
