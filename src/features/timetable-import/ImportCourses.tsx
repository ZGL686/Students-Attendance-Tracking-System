import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { useApp } from '../../context';
import { commitCourseImport, importFingerprint } from './commit';
import { DraftCourses } from './DraftCourses';
import type { CourseDraft, ImportMode } from './model';
import { createEmptyDraft, validateDrafts } from './model';
import { importAccept, inspectImportFile, readImportFile } from './read';

type Step = 'file' | 'review' | 'confirm';
type Source = { index: number; label: string };

export function ImportCourses({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const { data, busy, change } = useApp();
  const target = data.workspaces.find((workspace) => workspace.id === targetId);
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File>();
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceSelection, setSourceSelection] = useState<number[]>([]);
  const [drafts, setDrafts] = useState<CourseDraft[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>('append');
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ stage: '', progress: 0 });
  const [confirmedFingerprint, setConfirmedFingerprint] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);

  const unavailable = !target || !!target.deletedAt || data.activeWorkspaceId !== targetId;
  const chosen = drafts.filter((draft) => selected.has(draft.id));
  const validation = validateDrafts(chosen, target?.courses ?? [], mode, target?.totalWeeks ?? 30);
  const ready =
    !unavailable &&
    chosen.length > 0 &&
    validation.issues.length === 0 &&
    validation.courses.length > 0;

  function close() {
    if (busy) return;
    operation.current?.abort();
    onClose();
  }

  async function chooseFile(next: File) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setFile(next);
    setSources([]);
    setSourceSelection([]);
    setDrafts([]);
    setSelected(new Set());
    setWarnings([]);
    setError('');
    setProcessing(true);
    setProgress({ stage: '正在检查文件', progress: 0 });
    try {
      const found = await inspectImportFile(next, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSources(found);
      setSourceSelection(found.length ? [found[0].index] : []);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation.current === controller) setProcessing(false);
    }
  }

  async function read() {
    if (!file || !sourceSelection.length) return;
    const controller = new AbortController();
    operation.current = controller;
    setProcessing(true);
    setError('');
    setProgress({ stage: '正在读取课程', progress: 0 });
    try {
      const result = await readImportFile(file, {
        signal: controller.signal,
        selection: sourceSelection,
        onProgress: (next) => {
          if (!controller.signal.aborted) setProgress(next);
        },
      });
      if (controller.signal.aborted) return;
      setDrafts(result.drafts);
      setSelected(new Set(result.drafts.map((draft) => draft.id)));
      setWarnings(result.warnings);
      setStep('review');
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation.current === controller) setProcessing(false);
    }
  }

  function cancelRead() {
    operation.current?.abort();
    setProcessing(false);
    setError('识别已取消，课表未修改。');
  }

  function startManual() {
    const draft = createEmptyDraft(file?.name ?? '手动填写');
    setDrafts([draft]);
    setSelected(new Set([draft.id]));
    setWarnings(['文件未成功识别，请对照原文件手动填写课程。']);
    setError('');
    setStep('review');
  }

  async function save() {
    if (!ready || !target) return;
    setError('');
    const ok = await change(
      (latest) => commitCourseImport(latest, targetId, chosen, mode, confirmedFingerprint),
      `已向“${target.name}”导入 ${validation.courses.length} 门课程${validation.duplicates ? `，跳过 ${validation.duplicates} 门重复课程` : ''}`,
    );
    if (ok) onClose();
    else setError('保存未完成，课程草稿已保留。请根据错误提示处理后再试。');
  }

  return (
    <Modal
      title="导入课程"
      subtitle={`导入到：${target?.name ?? '原工作台'} · ${target?.term ?? ''}`}
      wide
      onClose={close}
    >
      <div className="timetable-import">
        <ol className="import-steps" aria-label="导入步骤">
          {(['选择文件', '检查修改', '确认保存'] as const).map((label, index) => (
            <li
              key={label}
              aria-current={
                index === ['file', 'review', 'confirm'].indexOf(step) ? 'step' : undefined
              }
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {unavailable && (
          <p className="form-error" role="alert">
            原工作台已切换或删除。请取消后在目标工作台重新导入。
          </p>
        )}
        {step === 'file' && (
          <>
            <label className="import-file">
              <FileUp size={26} />
              选择课表文件
              <input
                type="file"
                accept={`${importAccept},.xls`}
                disabled={processing || busy}
                onChange={(e) => {
                  const next = e.target.files?.[0];
                  e.target.value = '';
                  if (next) void chooseFile(next);
                }}
              />
              <small>支持图片、Excel .xlsx、UTF-8 CSV 和 PDF，最大 20 MB。文件仅在本机处理。</small>
            </label>
            {file && <p className="import-source">已选择：{file.name}</p>}
            {sources.length > 0 && !processing && (
              <fieldset className="import-sources">
                <legend>选择需要读取的工作表或页面</legend>
                {sources.map((source) => (
                  <label className="check-label" key={source.index}>
                    <input
                      type="checkbox"
                      checked={sourceSelection.includes(source.index)}
                      onChange={(e) =>
                        setSourceSelection(
                          e.target.checked
                            ? [...sourceSelection, source.index]
                            : sourceSelection.filter((index) => index !== source.index),
                        )
                      }
                    />
                    {source.label}
                  </label>
                ))}
              </fieldset>
            )}
            {processing && (
              <div className="import-progress" role="status" aria-live="polite">
                <span>
                  {progress.stage} · {Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}
                  %
                </span>
                <progress max={1} value={progress.progress} aria-label="识别进度" />
                <Button onClick={cancelRead}>取消识别</Button>
              </div>
            )}
            <p className="inline-note">
              识别结果需要逐项检查。未找到的星期、节次、周次会留空，修正后才能保存。
            </p>
          </>
        )}
        {step === 'review' && (
          <>
            {warnings.length > 0 && (
              <div className="inline-note">
                {warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
              </div>
            )}
            <fieldset className="import-mode">
              <legend>导入方式</legend>
              <label className="check-label">
                <input
                  type="radio"
                  name="course-import-mode"
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                />
                追加课程，跳过完全重复项
              </label>
              <label className="check-label">
                <input
                  type="radio"
                  name="course-import-mode"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                替换当前工作台课表
              </label>
            </fieldset>
            <DraftCourses
              drafts={drafts}
              selected={selected}
              issues={validation.issues}
              totalWeeks={target?.totalWeeks ?? 30}
              onEdit={(id, field, value) =>
                setDrafts(
                  drafts.map((draft) => (draft.id === id ? { ...draft, [field]: value } : draft)),
                )
              }
              onSelect={(id, checked) =>
                setSelected((previous) => {
                  const next = new Set(previous);
                  if (checked) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
              onDelete={(id) => {
                setDrafts(drafts.filter((draft) => draft.id !== id));
                setSelected((previous) => {
                  const next = new Set(previous);
                  next.delete(id);
                  return next;
                });
              }}
              onAdd={() => {
                const next = createEmptyDraft('手动补充');
                setDrafts([...drafts, next]);
                setSelected(new Set([...selected, next.id]));
              }}
            />
            <div className="import-summary" aria-live="polite">
              {validation.issues.length
                ? `有 ${validation.issues.length} 个问题需要修正，或取消勾选相关课程。`
                : `将导入 ${validation.courses.length} 门课程，跳过 ${validation.duplicates} 门完全重复课程。`}
              {mode === 'replace' && (
                <p>将替换原有的 {target?.courses.length ?? 0} 门课程，历史考勤保留。</p>
              )}
            </div>
          </>
        )}
        {step === 'confirm' && (
          <div className="import-confirm">
            <h3>确认{mode === 'replace' ? '替换课表' : '追加课程'}</h3>
            <p>
              工作台：<strong>{target?.name}</strong>
            </p>
            <p>
              本次导入 <strong>{validation.courses.length}</strong> 门课程；跳过{' '}
              {validation.duplicates} 门完全重复课程。
            </p>
            {mode === 'replace' && (
              <p className="form-error">
                将移除课表中原有的 {target?.courses.length ?? 0} 门课程，以本次勾选的课程替换。
              </p>
            )}
            <p>学生名单和历史考勤保持不变。完成保存后才会更新课表。</p>
            {target && confirmedFingerprint !== importFingerprint(target) && (
              <p className="form-error">课表或学期设置已变化，请返回检查页重新确认。</p>
            )}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <span className="spacer" />
          {step === 'file' && error && !processing && (
            <Button disabled={busy || unavailable} onClick={startManual}>
              手动填写课程
            </Button>
          )}
          {step !== 'file' && (
            <Button
              disabled={busy}
              onClick={() => {
                setError('');
                setStep(step === 'confirm' ? 'review' : 'file');
              }}
            >
              {step === 'confirm' ? '返回检查' : '重新选择文件'}
            </Button>
          )}
          {step === 'file' && (
            <Button
              className="primary"
              disabled={processing || !sourceSelection.length || unavailable}
              onClick={() => void read()}
            >
              识别并预览
            </Button>
          )}
          {step === 'review' && (
            <Button
              className="primary"
              disabled={!ready}
              onClick={() => {
                setConfirmedFingerprint(importFingerprint(target!));
                setError('');
                setStep('confirm');
              }}
            >
              下一步：确认保存
            </Button>
          )}
          {step === 'confirm' && (
            <Button
              className="primary"
              pending={busy}
              disabled={!ready || !target || confirmedFingerprint !== importFingerprint(target)}
              onClick={() => void save()}
            >
              {mode === 'replace' ? '确认替换并导入' : '确认导入'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
