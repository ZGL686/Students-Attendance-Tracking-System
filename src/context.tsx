import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppLogo, Button, Toast } from './components/ui';
import type { AppData, Workspace } from './model';
import { dataSchema, newWorkspace } from './model';
import { loadSeed } from './seed';
import { isAndroid } from './platform';
import * as storage from './storage';

type Context = {
  data: AppData;
  w: Workspace;
  revision: number;
  busy: boolean;
  saveFailed: boolean;
  notice: { text: string; error: boolean } | null;
  notify: (text: string, error?: boolean) => void;
  change: (fn: (d: AppData) => void, message?: string) => Promise<boolean>;
  update: (fn: (w: Workspace) => void, message?: string) => Promise<boolean>;
};
const C = createContext<Context | null>(null);
export const useApp = () => useContext(C)!;
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>();
  const [revision, setRevision] = useState(0);
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [notice, setNotice] = useState<Context['notice']>(null);
  const state = useRef<{ data: AppData; revision: number } | undefined>(undefined);
  const saving = useRef(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        let current = await storage.load();
        if (!current) {
          const initial = isAndroid
            ? dataSchema.parse(
                (() => {
                  const workspace = newWorkspace('请导入 Windows 备份');
                  return {
                    schemaVersion: 3,
                    activeWorkspaceId: workspace.id,
                    workspaces: [workspace],
                  };
                })(),
              )
            : await loadSeed();
          current = { data: initial, revision: await storage.save(initial, 0) };
        }
        state.current = current;
        setData(current.data);
        setRevision(current.revision);
      } catch (e) {
        setFatal(`读取数据失败，未覆盖已有数据。${String(e)}`);
      }
    })();
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  async function change(fn: (d: AppData) => void, message = '已保存') {
    if (saving.current || !state.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      const next = structuredClone(state.current.data);
      fn(next);
      dataSchema.parse(next);
      const rev = await storage.save(next, state.current.revision);
      state.current = { data: next, revision: rev };
      setData(next);
      setRevision(rev);
      setSaveFailed(false);
      if (message) notify(message);
      return true;
    } catch (e) {
      setSaveFailed(true);
      notify(`未保存：${e instanceof Error ? e.message : String(e)}`, true);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (fatal)
    return (
      <div className="fatal">
        <h1>数据暂时无法读取</h1>
        <p>{fatal}</p>
        <p>请保留原数据目录，检查磁盘权限与空间后重试。不要删除数据库或清理浏览器数据。</p>
        <Button onClick={() => window.location.reload()}>重新读取</Button>
      </div>
    );
  if (!data)
    return (
      <div className="loading">
        <AppLogo size={44} />
        <p>正在打开你的工作台…</p>
      </div>
    );
  const w = data.workspaces.find((w) => w.id === data.activeWorkspaceId)!;
  return (
    <C.Provider
      value={{
        data,
        w,
        revision,
        busy,
        saveFailed,
        notice,
        notify,
        change,
        update: (fn, message) =>
          change((d) => fn(d.workspaces.find((w) => w.id === d.activeWorkspaceId)!), message),
      }}
    >
      {children}
      {notice && (
        <Toast text={notice.text} error={notice.error} onDismiss={() => setNotice(null)} />
      )}
    </C.Provider>
  );
}
