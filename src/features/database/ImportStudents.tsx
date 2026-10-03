import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { useApp } from '../../context';
import { readRoster } from '../../files';
import { studentSchema } from '../../model';

export function ImportStudentsButton() {
  const { w, busy } = useApp();
  const [targetId, setTargetId] = useState<string>();
  return (
    <>
      <Button disabled={busy} onClick={() => setTargetId(w.id)}>
        <FileUp size={16} />
        导入学生名单
      </Button>
      {targetId && <ImportStudents targetId={targetId} onClose={() => setTargetId(undefined)} />}
    </>
  );
}

function ImportStudents({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const { data, change, busy, notify } = useApp();
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [conflicts, setConflicts] = useState<string[]>([]);
  const cancelled = useRef(false);
  const pending = useRef(false);
  const savingRef = useRef(false);
  const target = data.workspaces.find((workspace) => workspace.id === targetId);
  const unavailable = !target || target.deletedAt || data.activeWorkspaceId !== targetId;
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  function close() {
    if (savingRef.current) return;
    cancelled.current = true;
    onClose();
  }

  async function importFile(file: File) {
    if (pending.current || busy || unavailable) return;
    pending.current = true;
    setReading(true);
    setError('');
    setSummary('');
    setConflicts([]);
    try {
      const students = (await readRoster(file)).map((student) => studentSchema.parse(student));
      if (cancelled.current) return;
      savingRef.current = true;
      setSaving(true);
      const outcome = { added: 0, duplicates: 0, conflicts: [] as string[] };
      const saved = await change((latest) => {
        const workspace = latest.workspaces.find((item) => item.id === targetId);
        if (!workspace || workspace.deletedAt || latest.activeWorkspaceId !== targetId)
          throw new Error('目标工作台已切换或删除，请返回后重新导入。');
        const numbers = new Map(
          workspace.students.map((student) => [student.number.trim(), student]),
        );
        for (const student of students) {
          const existing = numbers.get(student.number);
          if (existing) {
            if (existing.name.trim() === student.name.trim()) outcome.duplicates++;
            else
              outcome.conflicts.push(
                `学号 ${student.number} 已对应“${existing.name}”，跳过“${student.name}”。`,
              );
          } else {
            workspace.students.push(student);
            numbers.set(student.number, student);
            outcome.added++;
          }
        }
      }, '');
      if (cancelled.current) return;
      if (!saved) {
        setError('名单未保存，请按错误提示处理后重试。');
        return;
      }
      const message = `已添加 ${outcome.added} 位学生，跳过 ${outcome.duplicates} 位重复学生${outcome.conflicts.length ? `和 ${outcome.conflicts.length} 项学号冲突` : ''}。`;
      setSummary(message);
      setConflicts(outcome.conflicts);
      notify(message);
      if (!outcome.conflicts.length) onClose();
    } catch (reason) {
      if (!cancelled.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      savingRef.current = false;
      if (!cancelled.current) {
        setReading(false);
        setSaving(false);
      }
    }
  }

  return (
    <Modal title="导入学生名单" subtitle={`添加到：${target?.name ?? '原工作台'}`} onClose={close}>
      <label className="import-file">
        <FileUp size={26} />
        选择学生名单
        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={reading || busy || !!unavailable}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importFile(file);
          }}
        />
        <small>Excel .xlsx 或 UTF-8 CSV，最大 10 MB。</small>
      </label>
      <p className="inline-note">
        第一张工作表需要“姓名”和“学号”表头，可选“班级”列。选择后自动添加到当前工作台；重复学号会跳过，已有学生资料和考勤记录保留。
      </p>
      {reading && <p role="status">{saving ? '正在保存名单…' : '正在读取名单…'}</p>}
      {summary && <p role="status">{summary}</p>}
      {conflicts.length > 0 && (
        <ul className="import-skipped">
          {conflicts.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
      {(error || unavailable) && (
        <p className="form-error" role="alert">
          {unavailable ? '工作台已切换或删除，请关闭后重新导入。' : error}
        </p>
      )}
      <div className="modal-actions">
        <Button disabled={saving} onClick={close}>
          {reading ? '取消' : '完成'}
        </Button>
      </div>
    </Modal>
  );
}
