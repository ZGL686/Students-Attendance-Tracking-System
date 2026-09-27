import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button, Modal } from '../../components/ui';
import type { Course } from '../../model';
import { formatWeeks, uid } from '../../model';
import { parseImportWeeks } from '../timetable-import/model';

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function CourseEditor({
  initial,
  onClose,
  onSave,
  onDelete,
  busy,
  totalWeeks,
}: {
  initial: Course | null;
  onClose: () => void;
  onSave: (c: Course) => Promise<boolean>;
  onDelete?: () => void;
  busy: boolean;
  totalWeeks: number;
}) {
  const [c, setC] = useState<Course>(
    initial ?? {
      id: uid(),
      name: '',
      teacher: '',
      room: '',
      day: 1,
      start: 1,
      end: 2,
      weeks: parseImportWeeks(`1-${Math.min(16, totalWeeks)}`),
      color: 'blue',
    },
  );
  const [weeks, setWeeks] = useState(formatWeeks(c.weeks));
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const field = (key: keyof Course, value: unknown) => setC({ ...c, [key]: value });
  return (
    <Modal
      title={initial ? '编辑课程' : '添加课程'}
      subtitle="课程调整不会修改已经登记的考勤信息。"
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (c.end < c.start) throw new Error('结束节次不能早于开始节次。');
            const parsed = parseImportWeeks(weeks);
            if (parsed.some((week) => week > totalWeeks))
              throw new Error(`上课周次不能超过当前学期的 ${totalWeeks} 周。`);
            await onSave({ ...c, name: c.name.trim(), weeks: parsed });
          } catch (e) {
            setError(String(e));
          }
        }}
      >
        <label>
          课程名称
          <input
            required
            maxLength={100}
            value={c.name}
            onChange={(e) => field('name', e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            任课教师
            <input value={c.teacher} onChange={(e) => field('teacher', e.target.value)} />
          </label>
          <label>
            教室
            <input value={c.room} onChange={(e) => field('room', e.target.value)} />
          </label>
        </div>
        <div className="form-grid three">
          <label>
            星期
            <select aria-label="星期" value={c.day} onChange={(e) => field('day', +e.target.value)}>
              {days.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
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
              value={c.start}
              onChange={(e) => field('start', +e.target.value)}
            />
          </label>
          <label>
            结束节次
            <input
              type="number"
              min={c.start}
              max={10}
              value={c.end}
              onChange={(e) => field('end', +e.target.value)}
            />
          </label>
        </div>
        <label>
          上课周次
          <input
            required
            value={weeks}
            onChange={(e) => setWeeks(e.target.value)}
            placeholder="例如：1-2,4-13"
          />
          <small>
            支持不连续周次、单双周，例如 1-2,4-13 或 1-16双周。当前学期共 {totalWeeks} 周。
          </small>
        </label>
        <div className="color-picker">
          {(['purple', 'blue', 'pink', 'green', 'amber', 'teal'] as const).map((color) => (
            <Button
              type="button"
              aria-label={`${color}颜色`}
              key={color}
              className={`swatch ${color} ${c.color === color ? 'chosen' : ''}`}
              onClick={() => field('color', color)}
            >
              {c.color === color && <Check size={16} />}
            </Button>
          ))}
        </div>
        {error && <p className="form-error">{error}</p>}
        {confirm && <p className="form-error">移除后将不再出现在课表中，已有考勤记录不受影响。</p>}
        <div className="modal-actions">
          {onDelete && (
            <Button
              type="button"
              className="danger-text"
              disabled={busy}
              onClick={() => (confirm ? onDelete() : setConfirm(true))}
            >
              {confirm ? '确认移除' : '移除课程'}
            </Button>
          )}
          <span className="spacer" />
          <Button type="button" onClick={onClose}>
            取消
          </Button>
          <Button className="primary" pending={busy}>
            保存课程
          </Button>
        </div>
      </form>
    </Modal>
  );
}
