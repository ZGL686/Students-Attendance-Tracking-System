import { FileUp, Image } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { useApp } from '../../context';
import { commitAutomaticCourseImport } from './commit';
import { readImportFile } from './read';

export function ImportCourses({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const { data, busy, change, notify } = useApp();
  const target = data.workspaces.find((workspace) => workspace.id === targetId);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [progress, setProgress] = useState({ stage: '', progress: 0 });
  const operation = useRef<AbortController | undefined>(undefined);
  const savingRef = useRef(false);
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
      setProgress({ stage: '正在保存课程', progress: 1 });
      savingRef.current = true;
      setSaving(true);
      const outcome = { imported: 0, duplicates: 0, skipped: [] as string[] };
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
      setWarnings(result.warnings);
      notify(message);
      if (!outcome.skipped.length && !result.warnings.length) onClose();
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        savingRef.current = false;
        setSaving(false);
        setProcessing(false);
      }
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
          <label className="import-file">
            <Image size={26} />
            从相册选择课表图片
            <input
              type="file"
              accept="image/*"
              disabled={processing || busy || unavailable}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importFile(file);
              }}
            />
            <small>支持 JPG、PNG、WebP、BMP 等可读取的图片。</small>
          </label>
          <label className="import-file">
            <FileUp size={26} />
            选择课表文件
            <input
              type="file"
              accept=".xlsx,.csv,.pdf,.xls"
              disabled={processing || busy || unavailable}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importFile(file);
              }}
            />
            <small>Excel .xlsx、UTF-8 CSV、PDF；自动读取全部工作表或页面。</small>
          </label>
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
