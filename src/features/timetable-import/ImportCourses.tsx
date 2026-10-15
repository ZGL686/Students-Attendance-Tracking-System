import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Modal } from '../../components/ui';
import { useApp } from '../../context';
import { commitAutomaticCourseImport } from './commit';
import {
  courseImportAccept,
  courseImportHint,
  courseImportLabel,
  tableImportOnly,
} from './import-policy';
import { createEmptyDraft, parseImportWeeks, validateDrafts } from './model';
import type { CourseCatalogEntry } from './model';
import { readImportFiles } from './read';

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
  const [catalog, setCatalog] = useState<CourseCatalogEntry[]>([]);
  const [catalogOnly, setCatalogOnly] = useState(false);
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

  async function importFiles(files: File[]) {
    if (operation.current || busy || unavailable) return;
    const controller = new AbortController();
    operation.current = controller;
    setFilename(files.map((file) => file.name).join('、'));
    setError('');
    setNoCourseReason('');
    setSummary('');
    setSkipped([]);
    setWarnings([]);
    setCatalogOnly(false);
    setProcessing(true);
    setProgress({ stage: '正在读取课表', progress: 0 });
    try {
      const result = await readImportFiles(files, {
        catalog,
        signal: controller.signal,
        onProgress: (next) => {
          if (!controller.signal.aborted)
            setProgress((previous) => ({
              ...next,
              progress: Math.max(
                previous.progress,
                Math.min(0.97, Math.max(0, Number.isFinite(next.progress) ? next.progress : 0)),
              ),
            }));
        },
      });
      if (controller.signal.aborted) return;
      setCatalog(result.catalog ?? []);
      if (!tableImportOnly && !result.drafts.length && result.catalog?.length) {
        setCatalogOnly(true);
        setSummary(
          `已识别 ${result.catalog.length} 条课程参考资料。目录没有星期和节次，请继续选择课表图片；这些资料会用于本次导入。`,
        );
        setWarnings(result.warnings);
        return;
      }
      const currentTarget = data.workspaces.find((workspace) => workspace.id === targetId);
      if (!currentTarget || currentTarget.deletedAt || data.activeWorkspaceId !== targetId)
        throw new Error('目标工作台已切换或删除，请返回目标工作台重新导入。');
      const drafts = result.drafts.map((draft) =>
        draft.layout === 'grid' && !draft.weeks.trim()
          ? { ...draft, weeks: `1-${currentTarget.totalWeeks}` }
          : draft,
      );
      const importWarnings = result.warnings;
      const ready = validateDrafts(
        drafts,
        currentTarget.courses,
        'append',
        currentTarget.totalWeeks,
      );
      const rejected = ready.issues.map((issue) => {
        const draft = drafts.find((item) => item.id === issue.draftId);
        return `${draft?.name || '未识别课程'}（${draft?.source || '课表'}）：${issue.message.replace('请调整或取消选中。', '本次已跳过。')}`;
      });
      setSkipped(rejected);
      if (!ready.courses.length && !ready.duplicates) {
        setWarnings(importWarnings);
        setNoCourseReason(
          result.documents
            ?.filter((document) => document.kind !== 'courses')
            .map((document) => `${document.source}：${document.message}`)
            .join('\n') ||
            (result.drafts.length
              ? `${result.drafts.length} 条内容未能导入，请查看下方原因。`
              : '文件中没有可导入的课程安排，请选择包含课程名称、星期和节次的课表文件。'),
        );
        return;
      }
      if (!ready.courses.length && ready.duplicates) {
        const message = rejected.length
          ? `识别完成，本次未新增课程：${ready.duplicates} 门已存在，${rejected.length} 项无法导入。课程表没有修改。`
          : `识别到的 ${ready.duplicates} 门课程已存在，没有重复添加。`;
        setSummary(message);
        setWarnings(importWarnings);
        notify(message);
        return;
      }
      setProgress({ stage: '正在保存课程', progress: 1 });
      savingRef.current = true;
      setSaving(true);
      const outcome = {
        imported: 0,
        duplicates: 0,
        skipped: [] as string[],
        inferredWeeks: 0,
        totalWeeks: 0,
        warnings: [] as string[],
      };
      const saved = await change((latest) => {
        if (controller.signal.aborted) throw new Error('导入已取消。');
        Object.assign(outcome, commitAutomaticCourseImport(latest, targetId, result.drafts));
      }, '');
      if (controller.signal.aborted) return;
      if (!saved) {
        setError('导入未保存，请按错误提示处理后重新选择文件。');
        return;
      }
      const message = `已导入 ${outcome.imported} 门课程，跳过 ${outcome.duplicates} 门重复课程${outcome.skipped.length ? `，${outcome.skipped.length} 项无法导入` : ''}。`;
      setSummary(message);
      setSkipped(outcome.skipped);
      const savedWarnings = [...importWarnings, ...outcome.warnings];
      setWarnings([...new Set(savedWarnings)]);
      notify(message);
      if (!outcome.skipped.length && !savedWarnings.length) onClose();
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (message.includes('没有识别到课程'))
          setNoCourseReason(
            '文件中没有可导入的课程安排，请选择包含课程名称、星期和节次的课表文件。',
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
        <p className="appearance-note">{courseImportHint}</p>
        <div className="import-picker-grid">
          <input
            ref={fileInput}
            className="import-file-input"
            type="file"
            multiple
            accept={courseImportAccept}
            disabled={processing || busy || unavailable}
            aria-label={courseImportLabel}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              if (files.length) void importFiles(files);
            }}
          />
          <Button
            className="primary import-pick-button"
            disabled={processing || busy || unavailable}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={20} />
            {courseImportLabel}
          </Button>
        </div>
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
        {!tableImportOnly && catalogOnly && catalog.length > 0 && (
          <section className="import-skipped" aria-label="已识别的课程目录">
            <h3>课程参考资料 · {catalog.length} 条</h3>
            <ul>
              {catalog.map((entry, index) => (
                <li key={`${entry.code}-${index}`}>
                  {entry.name} · {entry.code || '未识别代码'} · {entry.teacher || '教师待补充'}
                </li>
              ))}
            </ul>
            <p>继续点击上方按钮补选课表图片。目录资料仅在本次窗口保留，不会单独写入课表。</p>
          </section>
        )}
        {noCourseReason && (
          <section className="import-summary" role="status" aria-label="本次未导入">
            <h3>课表没有改动</h3>
            {noCourseReason.split('\n').map((message, index) => (
              <p key={index}>{message}</p>
            ))}
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
          </div>
        )}
        {(noCourseReason || skipped.length > 0) && (
          <section className="quick-course-entry" aria-label="手动补录课程">
            <details>
              <summary>手动补录课程</summary>
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
                      {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(
                        (day, index) => (
                          <option key={day} value={index + 1}>
                            {day}
                          </option>
                        ),
                      )}
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
                <div className="modal-actions">
                  <Button className="primary" pending={saving || busy}>
                    保存这门课程
                  </Button>
                </div>
              </form>
            </details>
          </section>
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
