import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareManagementRestart, verifyManagementRestart } from './native-management.mjs';
import { isolatedEnvironment, verifyNativeIsolation } from './native-isolation.mjs';
import {
  assertNativeOffline,
  monitorNativeRequests,
  prepareImportAndThemeRestart,
  verifyImportAndThemeRestart,
} from './native-import-themes.mjs';
const root = process.cwd();
await fs.mkdir(path.join(root, '.local'), { recursive: true });
const dataDir = await fs.mkdtemp(path.join(root, '.local', 'native-smoke-'));
await assert.rejects(fs.access(path.join(dataDir, 'webview')), { code: 'ENOENT' });
// Open a genuine v0.1 snapshot with fictional students. Never exercise the
// user's default directory or use the embedded personal roster for test writes.
const legacyWorkspace = {
  id: 'native-class',
  name: '桌面验收班',
  term: '2026–2027 第一学期',
  startDate: '2026-09-07',
  totalWeeks: 20,
  students: [
    { id: 's1', name: '测试甲', number: '0001', group: '验收班' },
    { id: 's2', name: '测试乙', number: '0002', group: '验收班' },
  ],
  courses: [],
  records: [
    {
      id: 'legacy-record',
      studentId: 's2',
      category: 'leave',
      date: '2026-09-15',
      time: '10:00',
      courseId: '',
      courseName: '升级前历史课程',
      teacher: '',
      room: '',
      note: '保留旧版记录',
      createdAt: '2026-09-15T02:00:00Z',
      updatedAt: '2026-09-15T02:00:00Z',
      voided: false,
    },
  ],
  categories: [
    { id: 'leave', label: '请假', color: 'blue' },
    { id: 'absent', label: '旷课', color: 'pink' },
    { id: 'late', label: '迟到', color: 'amber' },
    { id: 'early', label: '早退', color: 'purple' },
  ],
  periods: Array.from({ length: 10 }, (_, i) => ({
    start: String(i + 8).padStart(2, '0') + ':00',
    end: String(i + 8).padStart(2, '0') + ':45',
  })),
  notes: '迁移验收',
};
const legacyPayload = JSON.stringify({
  schemaVersion: 1,
  activeWorkspaceId: legacyWorkspace.id,
  workspaces: [legacyWorkspace],
});
const fixture = new DatabaseSync(path.join(dataDir, 'attendance.sqlite3'));
fixture.exec(
  "CREATE TABLE snapshots(revision INTEGER PRIMARY KEY,payload TEXT NOT NULL,saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
);
fixture.prepare('INSERT INTO snapshots(revision,payload) VALUES(1,?)').run(legacyPayload);
fixture.close();
const exe = path.resolve(process.argv[2] || 'src-tauri/target/release/guilu.exe');
let child;
const networks = [];
const errors = [];
async function launch() {
  child = spawn(exe, [], {
    env: {
      ...isolatedEnvironment(dataDir),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9333',
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  let browser;
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert(browser, 'Native WebView did not become available');
  await verifyNativeIsolation(child.pid, dataDir);
  const context = browser.contexts()[0];
  const network = await monitorNativeRequests(context);
  networks.push(network);
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page');
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('heading', { name: '课程表', exact: true }).waitFor({ timeout: 20000 });
  const location = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('data_location'));
  assert(location.startsWith(dataDir), 'Refusing test against non-isolated user data');
  return { browser, page, network };
}
try {
  let { browser, page, network } = await launch();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.app-main').getBoundingClientRect().width === innerWidth,
    );
    await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  }
  const initial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_data'));
  const data = JSON.parse(initial.payload);
  assert.equal(data.workspaces[0].students.length, 2);
  assert.equal(data.schemaVersion, 1);
  const student = data.workspaces[0].students[0];
  await page.getByRole('navigation').getByRole('button', { name: '考勤工作台' }).click();
  await page.getByLabel('登记课程', { exact: true }).selectOption('');
  await page.getByLabel('临时课程名称', { exact: true }).fill('桌面独立验收课程');
  await page.getByRole('button', { name: `${student.name}迟到加一` }).click();
  await page.getByRole('status').filter({ hasText: '已登记 1 条迟到' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '课程表', exact: true }).waitFor();
  let stored = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_data'));
  assert.equal(JSON.parse(stored.payload).workspaces[0].records.length, 2);
  assert.equal(JSON.parse(stored.payload).schemaVersion, 3);
  await page.getByRole('navigation').getByRole('button', { name: '学生数据库' }).click();
  await page.getByRole('button', { name: '测试甲的跟进状态', exact: true }).click();
  await page.getByLabel('编辑跟进状态').selectOption('跟进中');
  await page.locator('.cell-editor').getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '属性已保存' }).waitFor();
  await page.getByRole('tab', { name: '同学画廊' }).click();
  await page.locator('.database-gallery').waitFor();
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root: domRoot } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: domRoot.nodeId,
    selector: 'h1',
  });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  assert(
    fonts.some((f) => f.isCustomFont && f.postScriptName.startsWith('LudianRounded')),
    'Offline Chinese font did not render in native WebView',
  );
  await page.screenshot({ path: path.join(dataDir, 'database-desktop.png') });
  await page.getByRole('navigation').getByRole('button', { name: '数据与备份' }).click();
  const backupPath = path.join(dataDir, 'native-backup.json');
  const dialogSaved = new Promise((resolve, reject) => {
    const driver = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(root, 'scripts', 'save-dialog.ps1'),
        '-AppProcessId',
        String(child.pid),
        '-OutputFile',
        backupPath,
      ],
      { windowsHide: true },
    );
    let output = '';
    driver.stdout.on('data', (b) => (output += b));
    driver.stderr.on('data', (b) => (output += b));
    driver.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(output))));
  });
  void dialogSaved.catch(() => {});
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  await page.waitForTimeout(1000);
  console.log('Native export status:', await page.getByRole('status').allTextContents());
  await dialogSaved;
  await page.getByRole('status').filter({ hasText: '完整备份已导出' }).waitFor();
  assert.equal(
    JSON.parse(await fs.readFile(backupPath, 'utf8')).data.workspaces[0].records.length,
    2,
  );
  await page.getByRole('navigation').getByRole('button', { name: '课程表', exact: true }).click();
  await page.screenshot({ path: path.join(dataDir, 'desktop.png') });
  await page.getByRole('button', { name: '设置与偏好', exact: true }).click();
  await page.getByRole('tab', { name: '外观与交互' }).click();
  for (const [label, prefix] of [
    ['简洁黑体', 'NotoSansSC'],
    ['柔和圆体', 'LudianRounded'],
    ['手写文楷', 'LudianHand'],
  ]) {
    await page.getByRole('radio', { name: new RegExp(label) }).click();
    await page.evaluate(() => document.fonts.ready);
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'h1' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert(
      fonts.some((f) => f.isCustomFont && f.postScriptName.startsWith(prefix)),
      'Native font did not change: ' + label,
    );
  }
  await page.getByRole('button', { name: '舒适 · 15' }).click();
  await page.getByLabel('减少动态效果').check();
  const nativeFeatures = await prepareImportAndThemeRestart(page, dataDir, network);
  await prepareManagementRestart(page);
  await page.screenshot({ path: path.join(dataDir, 'appearance-desktop.png') });
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();

  await browser.close();
  child.kill();
  await new Promise((r) => setTimeout(r, 1200));
  ({ browser, page } = await launch());
  assert.equal(await page.locator('html').getAttribute('data-font'), 'handwritten');
  assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced');
  assert.equal(await page.locator('html').evaluate((el) => getComputedStyle(el).fontSize), '15px');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  stored = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_data'));
  await verifyManagementRestart(page);
  await verifyImportAndThemeRestart(page, nativeFeatures);
  stored = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('load_data'));
  const expectedRevisions = 11 + nativeFeatures.importedWrites;
  assert.equal(stored.revision, expectedRevisions);
  const finalData = JSON.parse(stored.payload);
  assert.equal(finalData.workspaces[0].courses.length, 1);
  assert.equal(finalData.workspaces[0].courses[0].name, nativeFeatures.courseName);
  assert.equal(finalData.workspaces[0].records[1].courseName, '桌面独立验收课程');
  assert.deepEqual(finalData.workspaces[0].records[0], legacyWorkspace.records[0]);
  assert.equal(finalData.workspaces[0].databases.students.cells.s1['custom:followup'], '跟进中');
  assert.equal(finalData.workspaces[0].databases.students.activeViewId, 'gallery');
  const original = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('read_snapshot', { revision: 1 }),
  );
  assert.equal(original, legacyPayload);
  const snapshots = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('list_snapshots'));
  assert.equal(snapshots.length, expectedRevisions);
  networks.forEach((item) => assertNativeOffline(item));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      roster: 2,
      persistentRecords: 2,
      legacySnapshotRetained: true,
      offlineFont: true,
      fontsVerified: 3,
      themePersisted: true,
      recycleBinPersistedAndRestored: true,
      minusAndRestore: true,
      sidebarRestored: true,
      preferencesPersisted: true,
      browserProfileIsolated: true,
      freshWebViewProfile: true,
      bundledPageImportPersisted: true,
      offlineChineseOcr: true,
      externalRequests: networks.flatMap((item) => [...item.external]),
      ocrResources: nativeFeatures.ocrResources,
      builtinThemePackPersisted: nativeFeatures.themePackId,
      revisions: snapshots.length,
      dataDir,
      exe,
    }),
  );
  await browser.close();
} finally {
  child?.kill();
}
