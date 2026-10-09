import { Image, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Modal } from '../../components/ui';
import { useApp } from '../../context';
import { commitAutomaticCourseImport } from './commit';
import { createEmptyDraft, parseImportWeeks, validateDrafts } from './model';
import { readImportFile } from './read';

export function ImportCourses({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const { data, busy, change, notify } = useApp();
  const target = data.workspaces.find((workspace) => workspace.id === targetId);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [noCourseReason, setNoCourseReason] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickDay, setQuickDay] = useState('1');
  const [quickStart, setQuickStart] = useState('1');
  const [quickEnd, setQuickEnd] = useState('2');
  const [quickWeeks, setQuickWeeks] = useState(`1-${Math.min(16, target?.totalWeeks ?? 16)}`);
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [progress, setProgress] = useState({ stage: '', progress: 0 });
  const operation = useRef<AbortController | undefined>(undefined);
  const savingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const unavailable = !target || !!target.deletedAt || data.activeWorkspaceId !== targetId;

  function close() {
    if (savingRef.current) return;
    operation.current?.abort();
    onClose();
  }

  async function importFile(file: File) {
    if (operation.current || busy || unavailable) return;
    const controller = new AbortController();
    operation.current = controller;
    setFilename(file.name);
    setError('');
    setNoCourseReason('');
    setSummary('');
    setSkipped([]);
    setWarnings([]);
    setProcessing(true);
    setProgress({ stage: '正在读取课表', progress: 0 });
    try {
      const result = await readImportFile(file, {
        signal: controller.signal,
        onProgress: (next) => {
          if (!controller.signal.aborted) setProgress(next);
        },
      });
      if (controller.signal.aborted) return;
      const currentTarget = data.workspaces.find((workspace) => workspace.id === targetId);
      if (!currentTarget || currentTarget.deletedAt || data.activeWorkspaceId !== targetId)
        throw new Error('目标工作台已切换或删除，请返回目标工作台重新导入。');
      const inferredWeekDrafts = result.drafts.filter(
        (draft) => draft.layout === 'grid' && !draft.weeks.trim(),
      ).length;
      const drafts = result.drafts.map((draft) =>
        draft.layout === 'grid' && !draft.weeks.trim()
          ? { ...draft, weeks: `1-${currentTarget.totalWeeks}` }
          : draft,
      );
      const importWarnings = inferredWeekDrafts
        ? [
            ...result.warnings,
            `${inferredWeekDrafts} 门课程未标注周次，已按当前学期 1–${currentTarget.totalWeeks} 周导入。`,
          ]
        : result.warnings;
      const ready = validateDrafts(
        drafts,
        currentTarget.courses,
        'append',
        currentTarget.totalWeeks,
      );
      if (!ready.courses.length && !ready.duplicates) {
        setWarnings(importWarnings);
        setSkipped(
          ready.issues.map((issue) => {
            const draft = drafts.find((item) => item.id === issue.draftId);
            return `${draft?.name || '未识别课程'}：${issue.message}`;
          }),
        );
        setNoCourseReason(
          result.drafts.length
            ? `识别到了 ${result.drafts.length} 条内容，但缺少可保存的完整课程信息。课程表没有修改；请在下面补录名称、星期、节次和周次。`
            : '没有识别到课程，课程表没有修改。你可以重新选择清晰图片或文件，也可以直接在下面补录课程。',
        );
        return;
      }
      if (!ready.courses.length && ready.duplicates) {
        const message = `识别到的 ${ready.duplicates} 门课程已存在，没有重复添加。`;
        setSummary(message);
        setWarnings(importWarnings);
        notify(message);
        return;
      }
      setProgress({ stage: '正在保存课程', progress: 1 });
      savingRef.current = true;
      setSaving(true);
      const outcome = { imported: 0, duplicates: 0, skipped: [] as string[] };
      const saved = await change((latest) => {
        if (controller.signal.aborted) throw new Error('导入已取消。');
        Object.assign(outcome, commitAutomaticCourseImport(latest, targetId, drafts));
      }, '');
      if (controller.signal.aborted) return;
      if (!saved) {
        setError('导入未保存，请按错误提示处理后重新选择文件。');
        return;
      }
      const message = `已导入 ${outcome.imported} 门课程，跳过 ${outcome.duplicates} 门重复课程${outcome.skipped.length ? `，${outcome.skipped.length} 项无法导入` : ''}。`;
      setSummary(message);
      setSkipped(outcome.skipped);
      setWarnings(importWarnings);
      notify(message);
      if (!outcome.skipped.length && !importWarnings.length) onClose();
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message.includes('没有识别到课程'))
          setNoCourseReason(
            '没有识别到课程，课程表没有修改。你可以重新选择清晰图片或文件，也可以直接在下面补录课程。',
          );
        else setError(message);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        savingRef.current = false;
        setSaving(false);
        setProcessing(false);
      }
    }
  }

  async function addQuickCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unavailable || savingRef.current) return;
    const currentTarget = data.workspaces.find((workspace) => workspace.id === targetId);
    if (!currentTarget || currentTarget.deletedAt || data.activeWorkspaceId !== targetId) return;
    let weeks: string;
    try {
      weeks = quickWeeks.trim();
      parseImportWeeks(weeks);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    const draft = {
      ...createEmptyDraft('手动补录'),
      name: quickName.trim(),
      day: quickDay,
      start: quickStart,
      end: quickEnd,
      weeks,
    };
    const ready = validateDrafts(
      [draft],
      currentTarget.courses,
      'append',
      currentTarget.totalWeeks,
    );
    if (!ready.courses.length) {
      setError(
        ready.duplicates
          ? '这门课程已经在课表中，没有重复添加。'
          : (ready.issues[0]?.message ?? '请检查课程信息。'),
      );
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    const saved = await change((latest) => {
      const latestTarget = latest.workspaces.find((workspace) => workspace.id === targetId);
      if (!latestTarget || latestTarget.deletedAt || latest.activeWorkspaceId !== targetId)
        throw new Error('目标工作台已切换或删除，请重新打开导入窗口。');
      const result = validateDrafts(
        [draft],
        latestTarget.courses,
        'append',
        latestTarget.totalWeeks,
      );
      if (!result.courses.length)
        throw new Error(result.issues[0]?.message ?? '这门课程已经在课表中，没有重复添加。');
      latestTarget.courses.push(...result.courses);
    }, '已添加课程');
    savingRef.current = false;
    setSaving(false);
    if (saved) {
      setQuickName('');
      setSummary('课程已添加。可以继续补录下一门，或重新选择课表文件。');
      setNoCourseReason('');
    }
  }

  return (
    <Modal
      title="导入课程"
      subtitle={`导入到：${target?.name ?? '原工作台'} · ${target?.term ?? ''}`}
      wide
      onClose={close}
    >
      <div className="timetable-import">
        <p className="inline-note">选择图片或文件后自动识别并保存课程，无需逐条修改或再次确认。</p>
        <div className="import-picker-grid">
          <input
            ref={fileInput}
            className="import-file-input"
            type="file"
            accept="image/*,.xlsx,.csv,.pdf"
            disabled={processing || busy || unavailable}
            aria-label="选择课程表图片或文件"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importFile(file);
            }}
          />
          <Button
            className="primary import-pick-button"
            disabled={processing || busy || unavailable}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={20} />
            选择课程表图片或文件
          </Button>
          <small>支持 JPG、PNG、WebP、BMP、Excel、CSV 和 PDF；识别后自动保存。</small>
        </div>
        <p className="appearance-note">
          最大 20
          MB，仅在本机处理。自动追加课程并跳过重复项；信息不完整或时间冲突的课程会列出原因，已有课表和历史考勤保留。
        </p>
        {filename && <p className="import-source">{filename}</p>}
        {processing && (
          <div className="import-progress" role="status" aria-live="polite">
            <span>
              {progress.stage} · {Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}%
            </span>
            <progress max={1} value={progress.progress} aria-label="导入进度" />
            {!saving && (
              <Button
                onClick={() => {
                  operation.current?.abort();
                  setError('导入已取消，课表未修改。');
                }}
              >
                取消导入
              </Button>
            )}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="inline-note">
            {warnings.map((message, index) => (
              <p key={index}>{message}</p>
            ))}
          </div>
        )}
        {summary && (
          <p className="import-summary" role="status">
            {summary}
          </p>
        )}
        {(noCourseReason || skipped.length > 0) && (
          <section className="quick-course-entry" aria-label="手动补录课程">
            <div className="quick-course-copy">
              <Image size={20} />
              <div>
                <h3>{noCourseReason ? '课表没有改动' : '补录未导入的课程'}</h3>
                <p>
                  {noCourseReason || '其余识别完整的课程已保存；可在这里补录下面未导入的课程。'}
                </p>
              </div>
            </div>
            <form onSubmit={(event) => void addQuickCourse(event)}>
              <label>
                课程名称
                <input
                  required
                  maxLength={100}
                  value={quickName}
                  onChange={(event) => setQuickName(event.target.value)}
                  placeholder="例如：数字媒体设计"
                />
              </label>
              <div className="quick-course-fields">
                <label>
                  星期
                  <select value={quickDay} onChange={(event) => setQuickDay(event.target.value)}>
                    {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day, index) => (
                      <option key={day} value={index + 1}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  开始节次
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={quickStart}
                    onChange={(event) => setQuickStart(event.target.value)}
                  />
                </label>
                <label>
                  结束节次
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={quickEnd}
                    onChange={(event) => setQuickEnd(event.target.value)}
                  />
                </label>
                <label>
                  上课周次
                  <input
                    required
                    value={quickWeeks}
                    onChange={(event) => setQuickWeeks(event.target.value)}
                    placeholder={`例如 1-${Math.min(16, target?.totalWeeks ?? 16)}`}
                  />
                </label>
              </div>
              <p className="appearance-note">
                周次默认按 1–{Math.min(16, target?.totalWeeks ?? 16)}{' '}
                周，可按课表修改；教师和教室可之后再补充。
              </p>
              <div className="modal-actions">
                <Button className="primary" pending={saving || busy}>
                  保存这门课程
                </Button>
              </div>
            </form>
          </section>
        )}
        {skipped.length > 0 && (
          <div className="import-skipped">
            <h3>未导入的课程</h3>
            <ul>
              {skipped.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
            <p>可重新上传信息完整的课表，系统会自动跳过已导入课程。</p>
          </div>
        )}
        {(error || unavailable) && (
          <p className="form-error" role="alert">
            {unavailable ? '原工作台已切换或删除，请关闭后重新导入。' : error}
          </p>
        )}
        <div className="modal-actions">
          <Button disabled={saving} onClick={close}>
            {processing ? '取消并关闭' : '完成'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
