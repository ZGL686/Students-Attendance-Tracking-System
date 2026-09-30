import { Check, Search, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Empty, PageHeading, Tag } from '../../components/ui';
import { useApp } from '../../context';
import { LinkedDatabaseDetail as DatabaseDetail } from '../database/LinkedDatabaseDetail';
import { setRecordsVoided } from './model';

export function RecordHistory() {
  const { w, update, busy } = useApp();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>();
  const [showVoided, setShowVoided] = useState(false);
  const students = new Map(w.students.map((student) => [student.id, student]));
  const categories = new Map(w.categories.map((category) => [category.id, category]));
  const records = w.records
    .filter((record) => showVoided || !record.voided)
    .filter((record) => {
      const student = students.get(record.studentId);
      const text = `${student?.name ?? ''} ${student?.number ?? ''} ${record.courseName} ${record.date}`;
      return text.includes(query.trim());
    })
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  return (
    <>
      <PageHeading page="records" description={`${w.name} · ${records.length} 条记录`} />
      <label className="mobile-student-search">
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="搜索考勤历史"
          placeholder="搜索姓名、学号、课程或日期"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="mobile-history-toolbar">
        <span>历史记录保留原课程快照</span>
        <Button className="small" onClick={() => setShowVoided((value) => !value)}>
          {showVoided ? '隐藏已撤销' : '显示已撤销'}
        </Button>
      </div>
      <div className="mobile-history-list">
        {records.map((record) => {
          const student = students.get(record.studentId);
          const category = categories.get(record.category);
          return (
            <article
              className={`mobile-history-card ${record.voided ? 'voided' : ''}`}
              key={record.id}
            >
              <div className="mobile-history-primary">
                <div>
                  <strong>{student?.name ?? '名单中已移除的学生'}</strong>
                  <small>
                    {student?.number ?? '学号不可用'} · {record.date} {record.time}
                  </small>
                </div>
                <Tag color={category?.color}>
                  {record.voided ? '已撤销' : (category?.label ?? '类型已移除')}
                </Tag>
              </div>
              <div className="mobile-history-course">
                <strong>{record.courseName}</strong>
                <span>
                  {record.room || '未填写教室'}
                  {record.teacher ? ` · ${record.teacher}` : ''}
                </span>
                {record.note && <small>{record.note}</small>}
              </div>
              <Button onClick={() => setEditing(record.id)}>查看 / 编辑记录</Button>
              <Button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  update(
                    (workspace) => setRecordsVoided(workspace, [record.id], !record.voided),
                    record.voided ? '记录已恢复' : '记录已撤销',
                  )
                }
              >
                {record.voided ? <Undo2 size={15} /> : <Check size={15} />}
                {record.voided ? '恢复记录' : '撤销记录'}
              </Button>
            </article>
          );
        })}
        {!records.length && (
          <Empty
            icon={<Check size={28} />}
            title="没有符合条件的记录"
            text={
              w.records.length
                ? '调整搜索条件，或显示已撤销记录。'
                : '登记考勤后，记录会保存在这里。'
            }
          />
        )}
      </div>
      {editing && (
        <DatabaseDetail kind="records" id={editing} onClose={() => setEditing(undefined)} />
      )}
    </>
  );
}
