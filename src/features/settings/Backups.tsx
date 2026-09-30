import { ArrowRight, Check, Download, HardDrive, History, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, PageHeading, Tag } from '../../components/ui';
import { useApp } from '../../context';
import { createBackup, chooseTextFile, download, parseBackup } from '../../files';
import type { AppData } from '../../model';
import { beijingNow, importAsCopies } from '../../model';
import {
  androidWorkspaceImported,
  isAndroid,
  isTauriApp,
  markAndroidWorkspaceImported,
} from '../../platform';
import * as storage from '../../storage';
import type { ConflictChoice, MergePreview } from '../backups/merge';
import {
  isPristineMobileData,
  initializePhoneFromWindows,
  mergePhoneIntoWindows,
  recordConflictKey,
  syncWindowsToPhone,
} from '../backups/merge';

type ImportMode = 'copy' | 'sync';
type Incoming = { data: AppData; source: 'file' | 'snapshot' };
function describeRecord(record: NonNullable<MergePreview['conflicts'][number]['phone']>) {
  return `${record.date} ${record.time} · ${record.courseName} · ${record.voided ? '已撤销' : '有效'}${record.note ? ` · ${record.note}` : ''}`;
}

export function Backups({ onImportComplete }: { onImportComplete?: () => void }) {
  const { data, revision, change, notify, busy } = useApp();
  const [location, setLocation] = useState('正在读取…');
  const [history, setHistory] = useState<storage.Snapshot[]>([]);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [mode, setMode] = useState<ImportMode>(isAndroid ? 'sync' : 'copy');
  const [choices, setChoices] = useState<Readonly<Record<string, ConflictChoice>>>({});
  const [working, setWorking] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  useEffect(() => {
    storage
      .location()
      .then(setLocation)
      .catch((error) => notify(String(error), true));
    storage
      .snapshots()
      .then(setHistory)
      .catch((error) => notify(String(error), true));
  }, [revision, notify]);

  const pristinePhone = isAndroid && !androidWorkspaceImported() && isPristineMobileData(data);
  const preview = useMemo(() => {
    if (!incoming || mode !== 'sync') return null;
    if (pristinePhone) return initializePhoneFromWindows(incoming.data);
    return isAndroid
      ? syncWindowsToPhone(data, incoming.data, choices)
      : mergePhoneIntoWindows(data, incoming.data, choices);
  }, [choices, data, incoming, mode, pristinePhone]);

  function showIncoming(value: AppData, source: Incoming['source']) {
    setIncoming({ data: value, source });
    setChoices({});
    setMode(source === 'snapshot' ? 'copy' : isAndroid ? 'sync' : 'copy');
  }

  async function readBackup(text: string) {
    if (text.length > 100 * 1024 * 1024) throw new Error('备份文件超过 100 MB。');
    showIncoming(await parseBackup(text), 'file');
  }

  async function chooseNativeBackup() {
    setWorking(true);
    try {
      const text = await chooseTextFile(['json']);
      if (text !== null) await readBackup(text);
    } catch (error) {
      notify(`备份未导入：${String(error)}`, true);
    } finally {
      setWorking(false);
    }
  }

  async function exportBackup() {
    setWorking(true);
    try {
      if (
        await download(
          `Ludian_完整备份_${beijingNow().date}_${Date.now()}.json`,
          await createBackup(data),
          'application/json',
        )
      )
        notify('完整备份已导出');
    } catch (error) {
      notify(`备份失败：${String(error)}`, true);
    } finally {
      setWorking(false);
    }
  }

  async function commitImport() {
    if (!incoming) return;
    const next = mode === 'copy' ? importAsCopies(data, incoming.data) : preview?.data;
    if (!next) return;
    if (
      await change(
        (current) => Object.assign(current, next),
        mode === 'copy' ? '已恢复为独立工作台' : '备份数据已合并',
      )
    ) {
      if (isAndroid && mode === 'sync') markAndroidWorkspaceImported();
      setIncoming(null);
      onImportComplete?.();
    }
  }

  const incomingWorkspaceNames = incoming?.data.workspaces
    .map((workspace) => workspace.name)
    .join('、');

  return (
    <>
      <PageHeading
        page="backups"
        description={
          isAndroid
            ? pristinePhone
              ? '导入 Windows 备份，或从右上角全部功能新建班级。'
              : '通过 JSON 文件在手机和 Windows 间手动同步考勤数据。'
            : '定期导出完整备份，或把手机上的新增考勤合并回 Windows。'
        }
      />
      <div className="backup-banner">
        <span>
          <ShieldCheck size={30} strokeWidth={1.4} />
        </span>
        <div>
          <h3>{storage.desktop ? '本地数据，独立保存' : '浏览器预览 · 本地保存'}</h3>
          <p>
            {storage.desktop
              ? '数据保存在本机应用目录。同步通过你选择的 JSON 文件完成，不连接云端。'
              : '预览数据与桌面应用独立。可用完整备份迁移；清理浏览器数据会清除预览记录。'}
          </p>
        </div>
        <Tag color="green">已保存 · v{revision}</Tag>
      </div>
      {isAndroid && pristinePhone && (
        <div className="mobile-import-prompt">
          <strong>导入已有班级，或直接在手机新建</strong>
          <p>
            从 Windows 导出的 JSON 可保留原工作台、学生和课程
            ID。也可以通过右上角“全部功能”新建班级、导入名单或添加课程。
          </p>
        </div>
      )}
      <div className="backup-actions">
        <section>
          <span className="icon-tile">
            <Download size={22} />
          </span>
          <h3>导出完整备份</h3>
          <p>包括工作台、学生名单、课程、考勤记录和已撤销记录，保存为 JSON 文件。</p>
          <Button className="primary" disabled={working} onClick={exportBackup}>
            <Download size={16} />
            导出备份
          </Button>
        </section>
        <section>
          <span className="icon-tile">
            <Upload size={22} />
          </span>
          <h3>
            {isAndroid
              ? pristinePhone
                ? '导入 Windows 备份'
                : '更新课表并合并考勤'
              : '恢复或合并备份'}
          </h3>
          <p>
            {isAndroid
              ? '首次导入保留原工作台 ID；后续同步更新 Windows 名单和课程，同时保留手机考勤。'
              : '可恢复为独立副本，或只把手机新增考勤合并进匹配的 Windows 工作台。'}
          </p>
          {isTauriApp ? (
            <Button className="primary" disabled={working} onClick={chooseNativeBackup}>
              <Upload size={16} />
              选择备份文件
            </Button>
          ) : (
            <label className="file-button">
              <Upload size={16} />
              选择备份文件
              <input
                key={inputKey}
                type="file"
                accept=".json,application/json"
                aria-label="选择备份文件"
                disabled={working}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  setInputKey((key) => key + 1);
                  if (!file) return;
                  setWorking(true);
                  try {
                    if (file.size > 100 * 1024 * 1024) throw new Error('备份文件超过 100 MB。');
                    await readBackup(await file.text());
                  } catch (error) {
                    notify(`备份未导入：${String(error)}`, true);
                  } finally {
                    setWorking(false);
                  }
                }}
              />
            </label>
          )}
        </section>
      </div>
      {isAndroid && (
        <p className="backup-privacy-note">
          备份是未加密 JSON，含学生和考勤信息，请只通过你信任的本地方式传输。
        </p>
      )}
      <section className="data-location">
        <HardDrive size={19} />
        <div>
          <h3>数据存储位置</h3>
          <code>{location}</code>
          <p>应用更新不会清除本机数据；另请把导出的备份保存到可靠的位置。</p>
        </div>
      </section>
      {
        <section className="snapshot-section">
          <div className="report-table-heading">
            <h3>
              <History size={18} />
              最近的保存快照
            </h3>
            <span>显示最近 30 次 · 完整历史保留在本机</span>
          </div>
          <div className="snapshot-list">
            {history.map((snapshot) => (
              <div key={snapshot.revision}>
                <span className="snapshot-version">v{snapshot.revision}</span>
                <span>
                  {new Date(snapshot.savedAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    hour12: false,
                  })}
                </span>
                {snapshot.revision === revision ? (
                  <Tag color="green">当前版本</Tag>
                ) : (
                  <Button
                    className="text-button"
                    onClick={async () => {
                      try {
                        showIncoming(await storage.snapshot(snapshot.revision), 'snapshot');
                      } catch (error) {
                        notify(String(error), true);
                      }
                    }}
                  >
                    恢复为副本 <ArrowRight size={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      }
      {incoming && (
        <Modal
          wide
          title={
            mode === 'copy'
              ? '恢复备份副本'
              : pristinePhone
                ? '首次导入到手机'
                : isAndroid
                  ? 'Windows → 手机同步'
                  : '合并手机考勤'
          }
          subtitle={
            mode === 'copy'
              ? '备份将作为新的工作台加入，现有工作台不会被覆盖。'
              : isAndroid
                ? 'Windows 的课程和名单为准；手机已有考勤会保留。'
                : '仅合并工作台 ID 匹配的考勤记录，Windows 名单、课程和其他数据保持原样。'
          }
          onClose={() => setIncoming(null)}
        >
          {incoming.source === 'file' && (
            <div className="backup-import-modes" role="group" aria-label="备份导入方式">
              <Button className={mode === 'copy' ? 'selected' : ''} onClick={() => setMode('copy')}>
                恢复为独立副本
              </Button>
              <Button className={mode === 'sync' ? 'selected' : ''} onClick={() => setMode('sync')}>
                {isAndroid ? '更新本机名单与课表' : '合并手机考勤'}
              </Button>
            </div>
          )}
          {mode === 'copy' ? (
            <div className="restore-preview">
              {incoming.data.workspaces.map((workspace) => (
                <div key={workspace.id}>
                  <strong>
                    {workspace.name}
                    {workspace.deletedAt ? '（回收站）' : ''}
                  </strong>
                  <span>
                    {workspace.students.length} 位同学 ·{' '}
                    {workspace.records.filter((record) => !record.voided).length} 条有效记录
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="sync-summary">
                <strong>{incomingWorkspaceNames}</strong>
                <span>
                  新增工作台 {preview?.addedWorkspaces ?? 0} 个 · 新增考勤{' '}
                  {preview?.addedRecords ?? 0} 条 · 完全重复跳过 {preview?.unchangedRecords ?? 0} 条
                </span>
              </div>
              {!!preview?.issues.length && (
                <div className="sync-issues" role="alert">
                  <strong>无法安全合并，请先处理以下问题：</strong>
                  {preview.issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              )}
              {!!preview?.conflicts.length && (
                <section className="sync-conflicts">
                  <h3>发现 {preview.conflicts.length} 条相同 ID 的不同记录</h3>
                  <p>默认保留 Windows 版本；可逐条选择手机或 Windows 内容。</p>
                  {preview.conflicts.map((conflict) => {
                    const selected =
                      choices[recordConflictKey(conflict.workspaceId, conflict.phone.id)] ??
                      'windows';
                    return (
                      <fieldset className="sync-conflict" key={conflict.key}>
                        <legend>
                          {conflict.workspaceName} · {conflict.studentName}
                        </legend>
                        <div className="sync-choice-list">
                          {(['windows', 'phone'] as const).map((side) => {
                            const record = conflict[side];
                            return (
                              <label key={side}>
                                <input
                                  type="radio"
                                  name={conflict.key}
                                  checked={selected === side}
                                  onChange={() =>
                                    setChoices((current) => ({ ...current, [conflict.key]: side }))
                                  }
                                />
                                <span>
                                  <strong>
                                    {side === 'windows' ? '保留 Windows' : '保留手机'}
                                  </strong>
                                  <small>{describeRecord(record)}</small>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    );
                  })}
                </section>
              )}
            </>
          )}
          <div className="modal-actions">
            <Button onClick={() => setIncoming(null)}>取消</Button>
            <Button
              className="primary"
              pending={busy}
              disabled={mode === 'sync' && !preview?.data}
              onClick={commitImport}
            >
              <Check size={15} />
              {mode === 'copy' ? '确认恢复' : pristinePhone ? '导入并初始化手机' : '确认合并'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
