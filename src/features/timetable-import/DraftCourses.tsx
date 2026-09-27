import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '../../components/ui';
import type { CourseDraft } from './model';

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
type EditableField = 'name' | 'teacher' | 'room' | 'day' | 'start' | 'end' | 'weeks';

export function DraftCourses({
  drafts,
  selected,
  issues,
  totalWeeks,
  onEdit,
  onSelect,
  onDelete,
  onAdd,
}: {
  drafts: CourseDraft[];
  selected: Set<string>;
  issues: { draftId: string; message: string }[];
  totalWeeks: number;
  onEdit: (id: string, field: EditableField, value: string) => void;
  onSelect: (id: string, checked: boolean) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="import-drafts">
      <div className="import-draft-heading">
        <p>
          已选 {selected.size} / {drafts.length} 门 · 当前学期 {totalWeeks} 周
        </p>
        <Button className="small" onClick={onAdd}>
          <Plus size={15} />
          补充课程
        </Button>
      </div>
      {!drafts.length && (
        <p className="inline-note">没有识别到课程，可补充课程或返回选择其他文件。</p>
      )}
      {drafts.map((draft, index) => {
        const messages = issues.filter((issue) => issue.draftId === draft.id);
        const chosen = selected.has(draft.id);
        return (
          <section
            className={`import-draft ${chosen ? '' : 'excluded'}`}
            aria-label={`待导入课程 ${index + 1}`}
            key={draft.id}
          >
            <div className="import-draft-heading">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={chosen}
                  onChange={(e) => onSelect(draft.id, e.target.checked)}
                />
                导入第 {index + 1} 门
              </label>
              <IconButton label={`删除第 ${index + 1} 门草稿`} onClick={() => onDelete(draft.id)}>
                <Trash2 size={16} />
              </IconButton>
            </div>
            <p className="import-source">来源：{draft.source || '手动补充'}</p>
            {(draft.rawText || draft.issues.length > 0) && (
              <details className="import-recognition">
                <summary>查看原始识别文字与提示</summary>
                {draft.rawText && <pre>{draft.rawText}</pre>}
                {draft.issues.length > 0 && (
                  <ul>
                    {draft.issues.map((issue, issueIndex) => (
                      <li key={issueIndex}>{issue}</li>
                    ))}
                  </ul>
                )}
              </details>
            )}
            <div className="form-grid three">
              {(['name', 'teacher', 'room'] as const).map((field, i) => (
                <label key={field}>
                  {['课程名称', '任课教师', '教室'][i]}
                  <input
                    value={draft[field]}
                    maxLength={field === 'name' ? 100 : 2000}
                    onChange={(e) => onEdit(draft.id, field, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="import-time-grid">
              <label>
                星期
                <select
                  aria-label="星期"
                  value={draft.day}
                  onChange={(e) => onEdit(draft.id, 'day', e.target.value)}
                >
                  <option value="">请选择</option>
                  {draft.day && !/^[1-7]$/.test(draft.day) && (
                    <option value={draft.day}>{draft.day}（待修正）</option>
                  )}
                  {days.map((day, dayIndex) => (
                    <option key={day} value={dayIndex + 1}>
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
                  value={draft.start}
                  onChange={(e) => onEdit(draft.id, 'start', e.target.value)}
                />
              </label>
              <label>
                结束节次
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={draft.end}
                  onChange={(e) => onEdit(draft.id, 'end', e.target.value)}
                />
              </label>
              <label>
                上课周次
                <input
                  value={draft.weeks}
                  placeholder="例如 1-16单周、2,4,8-10"
                  onChange={(e) => onEdit(draft.id, 'weeks', e.target.value)}
                />
              </label>
            </div>
            {chosen && messages.length > 0 && (
              <ul className="import-issues" aria-label="待修正问题">
                {messages.map((issue, issueIndex) => (
                  <li key={issueIndex}>{issue.message}</li>
                ))}
              </ul>
            )}
            {!chosen && <p className="import-source">本次不导入此课程。</p>}
          </section>
        );
      })}
    </div>
  );
}
