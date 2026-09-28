import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button, Empty, IconButton, Modal, Tag } from '../../components/ui';
import { useApp } from '../../context';
import type { AttendanceRecord, Session, Student } from '../../model';
import { counts } from '../../model';
import { RecordEditor } from './RecordEditor';
import { sameSession, setRecordsVoided } from './model';
export function StudentDetail({
  student,
  category,
  session,
  readOnly = false,
  onClose,
}: {
  student: Student;
  category?: string;
  session: Session;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { w, update, busy } = useApp();
  const [editing, setEditing] = useState<AttendanceRecord>();
  const [showVoided, setShowVoided] = useState(false);
  const records = w.records
    .filter(
      (r) =>
        r.studentId === student.id &&
        (!category || r.category === category) &&
        (showVoided || !r.voided),
    )
    .sort(
      (a, b) =>
        Number(sameSession(b, session)) - Number(sameSession(a, session)) ||
        (b.date + b.time).localeCompare(a.date + a.time),
    );
  const c = counts(w, student.id);
  return (
    <Modal
      wide
      title={`${student.name}的${category ? w.categories.find((c) => c.id === category)?.label : '考勤'}明细`}
      subtitle={`${student.number} · ${student.group || w.name}`}
      onClose={onClose}
    >
      <div className="student-summary">
        {w.categories.map((k) => (
          <div key={k.id}>
            <Tag color={k.color}>{k.label}</Tag>
            <strong>
              {c[k.id]}
              <small>次</small>
            </strong>
          </div>
        ))}
      </div>
      <div className="detail-toolbar">
        <h3>登记记录</h3>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
          />
          显示已撤销记录
        </label>
      </div>
      <p className="appearance-note">
        选择具体记录撤销，累计次数会随之减少；勾选“显示已撤销记录”可恢复。所选日期与课程的记录优先展示。
      </p>
      <div className="record-list">
        {records.map((r) => (
          <div className={`record-item ${r.voided ? 'voided' : ''}`} key={r.id}>
            <div className="record-date">
              <b>{r.date.slice(5).replace('-', '/')}</b>
              <small>
                {r.date.slice(0, 4)} · {r.time}
              </small>
            </div>
            <div className="record-body">
              <strong>{r.courseName}</strong>
              {sameSession(r, session) && <Tag color="blue">本次课程</Tag>}
              <p>
                {r.room || '未填写教室'}
                {r.teacher ? ` · ${r.teacher}` : ''}
              </p>
              {r.note && <p className="record-note">{r.note}</p>}
            </div>
            <Tag color={w.categories.find((c) => c.id === r.category)?.color}>
              {r.voided ? '已撤销' : w.categories.find((c) => c.id === r.category)?.label}
            </Tag>
            {!readOnly && (
              <IconButton label="编辑记录" disabled={r.voided} onClick={() => setEditing(r)}>
                <Pencil size={15} />
              </IconButton>
            )}
            <Button
              className="text-button"
              disabled={busy}
              onClick={() =>
                update(
                  (w) => setRecordsVoided(w, [r.id], !r.voided),
                  r.voided ? '记录已恢复' : '记录已撤销',
                )
              }
            >
              {r.voided ? '恢复' : '撤销'}
            </Button>
          </div>
        ))}
        {!records.length && (
          <Empty
            icon={<Check size={28} />}
            title="暂无异常考勤记录"
            text="登记的每一条考勤都会保留日期、课程和备注。"
          />
        )}
      </div>
      {editing && (
        <RecordEditor
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (record) => {
            if (
              await update((w) => {
                w.records[w.records.findIndex((r) => r.id === record.id)] = record;
              }, '考勤明细已更新')
            )
              setEditing(undefined);
          }}
        />
      )}
    </Modal>
  );
}
