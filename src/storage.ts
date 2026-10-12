import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AppData } from './model';
import { dataSchema } from './model';
import { browserDatabaseName, isPhonePreview } from './browserEnvironment';
export const desktop = isTauri();
type Stored = { revision: number; payload: string; savedAt: string };
export type Snapshot = { revision: number; savedAt: string };
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(browserDatabaseName, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('snapshots', { keyPath: 'revision' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function load(): Promise<{ data: AppData; revision: number } | null> {
  let stored: Stored | null;
  if (desktop) stored = await invoke('load_data');
  else {
    const database = await db();
    stored = await new Promise((resolve, reject) => {
      const r = database.transaction('snapshots').objectStore('snapshots').openCursor(null, 'prev');
      r.onsuccess = () => resolve(r.result?.value ?? null);
      r.onerror = () => reject(r.error);
    });
  }
  return stored
    ? { data: dataSchema.parse(JSON.parse(stored.payload)), revision: stored.revision }
    : null;
}
export async function save(data: AppData, expectedRevision: number): Promise<number> {
  const payload = JSON.stringify(dataSchema.parse(data));
  if (desktop) return invoke('save_data', { expectedRevision, payload });
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('snapshots', 'readwrite');
    const s = tx.objectStore('snapshots');
    const r = s.openCursor(null, 'prev');
    let conflict = false;
    r.onsuccess = () => {
      if ((r.result?.value.revision ?? 0) !== expectedRevision) {
        conflict = true;
        tx.abort();
        return;
      }
      s.add({ revision: expectedRevision + 1, payload, savedAt: new Date().toISOString() });
    };
    tx.oncomplete = () => resolve(expectedRevision + 1);
    tx.onabort = () =>
      reject(
        new Error(
          conflict
            ? '数据已在其他窗口更新，请刷新后再操作。'
            : '保存失败，可能是存储空间不足。原有数据保持不变。',
        ),
      );
    tx.onerror = () => reject(tx.error);
  });
}
export async function location() {
  return desktop
    ? invoke<string>('data_location')
    : isPhonePreview
      ? '手机模拟器的独立示例数据空间'
      : '当前浏览器的本地数据空间（与桌面版独立，可通过 JSON 备份迁移）';
}
export async function snapshots(): Promise<Snapshot[]> {
  if (desktop) return invoke('list_snapshots');
  const database = await db();
  return new Promise((resolve, reject) => {
    const r = database.transaction('snapshots').objectStore('snapshots').openCursor(null, 'prev');
    const all: Snapshot[] = [];
    r.onsuccess = () => {
      const c = r.result;
      if (c && all.length < 30) {
        all.push({ revision: c.value.revision, savedAt: c.value.savedAt });
        c.continue();
      } else resolve(all);
    };
    r.onerror = () => reject(r.error);
  });
}
export async function snapshot(revision: number): Promise<AppData> {
  let payload: string;
  if (desktop) payload = await invoke('read_snapshot', { revision });
  else {
    const database = await db();
    payload = await new Promise((resolve, reject) => {
      const r = database.transaction('snapshots').objectStore('snapshots').get(revision);
      r.onsuccess = () => (r.result ? resolve(r.result.payload) : reject(new Error('快照不存在')));
      r.onerror = () => reject(r.error);
    });
  }
  return dataSchema.parse(JSON.parse(payload));
}
