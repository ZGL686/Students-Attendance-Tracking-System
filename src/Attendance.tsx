import {
  ArrowUpRight,
  Check,
  CheckSquare,
  FileText,
  Plus,
  Minus,
  Search,
  SlidersHorizontal,
  Square,
  Undo2,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Button, Empty, IconButton, Modal, PageHeading, Tag } from './components/ui';
import { useApp } from './context';
import { SessionFields } from './features/attendance/SessionFields';
import { StudentDetail } from './features/attendance/StudentDetail';
import { setRecordsVoided } from './features/attendance/model';
import { RecordEditor } from './features/attendance/RecordEditor';
import type { AttendanceRecord, Session, Student } from './model';
import { beijingNow, counts, matchCourse, uid } from './model';
export function Attendance({
  session,
  mobile = false,
  onReports,
}: {
  session?: Session;
  mobile?: boolean;
  onReports: () => void;
}) {
  const { w, update, busy, notify } = useApp();
  const now = beijingNow();
  const matched = matchCourse(w, now.date, now.time);
  const [context, setContext] = useState<Session>(
    session ?? { ...now, courseId: matched?.id ?? '', courseName: matched?.name ?? '' },
  );
  const [query, setQuery] = useState('');
  const [onlyRecords, setOnlyRecords] = useState(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [category, setCategory] = useState<string>();
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState(false);
  const [note, setNote] = useState('');
  const [lastIds, setLastIds] = useState<string[]>([]);
  const recent = w.records.filter((r) => lastIds.includes(r.id));
  const recentVoided = recent.length > 0 && recent.every((r) => r.voided);
  function openDetail(student: Student, category?: string) {
    setStudent(student);
    setCategory(category);
  }
  const total = w.records.filter((r) => !r.voided).length;
  const shown = w.students.filter(
    (s) =>
      (s.name.includes(query) || s.number.includes(query)) &&
      (!onlyRecords || w.records.some((r) => !r.voided && r.studentId === s.id)),
  );
  async function add(ids: string[], category: string) {
    if (!context.courseName.trim()) {
      notify('请先选择课程，或填写临时课程名称。', true);
      return;
    }
    const c = w.courses.find((c) => c.id === context.courseId);
    const created = new Date().toISOString();
    const entries: AttendanceRecord[] = ids.map((studentId) => ({
      id: uid(),
      studentId,
      category,
      date: context.date,
      time: context.time,
      courseId: context.courseId,
      courseName: context.courseName.trim(),
      teacher: c?.teacher ?? '',
      room: c?.room ?? '',
      note,
      createdAt: created,
      updatedAt: created,
      voided: false,
    }));
    if (
      await update(
        (w) => w.records.push(...entries),
        `已登记 ${entries.length} 条${w.categories.find((c) => c.id === category)?.label}记录`,
      )
    ) {
      setLastIds(entries.map((r) => r.id));
      setBatch(false);
      setSelected([]);
    }
  }
  return (
    <>
      <PageHeading
        page="attendance"
        description={`${w.name} · ${w.students.length} 位同学 · ${w.term}`}
        actions={
          mobile ? null : (
            <>
              <Button onClick={onReports}>
                <FileText size={16} />
                查看汇总
              </Button>
              <Button className="primary" onClick={() => setManual(true)}>
                <Plus size={16} />
                补记考勤
              </Button>
            </>
          )
        }
      />
      <SessionFields context={context} setContext={setContext} note={note} setNote={setNote} />
      <div className="table-toolbar">
        <div className="tabs">
          <Button className={!onlyRecords ? 'active' : ''} onClick={() => setOnlyRecords(false)}>
            <Users size={16} />
            全部同学<span>{w.students.length}</span>
          </Button>
          <Button className={onlyRecords ? 'active' : ''} onClick={() => setOnlyRecords(true)}>
            有考勤记录
          </Button>
        </div>
        <div className="toolbar-right">
          <div className="search-box">
            <Search size={16} />
            <input
              aria-label="搜索同学"
              placeholder="搜索姓名、学号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button className="small" disabled={!selected.length} onClick={() => setBatch(true)}>
            <SlidersHorizontal size={15} />
            批量登记{selected.length > 0 ? ` (${selected.length})` : ''}
          </Button>
        </div>
      </div>
      {lastIds.length > 0 && (
        <div className="undo-bar">
          <Check size={15} />
          {recentVoided
            ? `最近 ${recent.length} 条登记已撤销`
            : `最近登记 ${recent.length} 条 · 当前有效 ${recent.filter((r) => !r.voided).length} 条`}
          <Button
            onClick={() =>
              update(
                (w) => setRecordsVoided(w, lastIds, !recentVoided),
                recentVoided ? '已恢复最近一次登记' : '已撤销最近一次登记',
              )
            }
            disabled={busy}
          >
            <Undo2 size={14} />
            {recentVoided ? '恢复登记' : '撤销'}
          </Button>
        </div>
      )}
      <div className={`table-container ${mobile ? 'mobile-student-list' : ''}`}>
        {mobile && (
          <div className="mobile-student-cards">
            {shown.map((s) => {
              const cs = counts(w, s.id);
              return (
                <article className="mobile-student-card" key={s.id}>
                  <div className="mobile-student-heading">
                    <Button className="student-name" onClick={() => openDetail(s)}>
                      <strong>{s.name}</strong>
                    </Button>
                    <span>{s.number}</span>
                  </div>
                  {s.group && <small className="mobile-student-group">{s.group}</small>}
                  <div className="mobile-category-actions">
                    {w.categories.map((c) => (
                      <div className="mobile-category-action" key={c.id}>
                        <Tag color={c.color}>{c.label}</Tag>
                        <strong className={cs[c.id] ? `count-value ${c.color}` : 'zero'}>
                          {cs[c.id] || '0'}
                        </strong>
                        <IconButton
                          label={`${s.name}${c.label}减一`}
                          disabled={busy || !cs[c.id]}
                          onClick={() => openDetail(s, c.id)}
                        >
                          <Minus size={17} />
                        </IconButton>
                        <Button
                          aria-label={`${s.name}${c.label}加一`}
                          disabled={busy}
                          onClick={() => add([s.id], c.id)}
                        >
                          <Plus size={17} />
                        </Button>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!mobile && (
          <table className="student-table">
            <thead>
              <tr>
                <th className="check-cell">
                  <Button
                    className="checkbox-button"
                    aria-label="选择全部筛选同学"
                    onClick={() =>
                      setSelected(
                        shown.length && shown.every((s) => selected.includes(s.id))
                          ? []
                          : shown.map((s) => s.id),
                      )
                    }
                  >
                    {shown.length > 0 && shown.every((s) => selected.includes(s.id)) ? (
                      <CheckSquare size={17} />
                    ) : (
                      <Square size={17} />
                    )}
                  </Button>
                </th>
                <th>
                  姓名 <span className="header-light">Aa</span>
                </th>
                <th>学号</th>
                {w.categories.map((c) => (
                  <th key={c.id}>
                    <Tag color={c.color}>{c.label}</Tag>
                  </th>
                ))}
                <th>累计</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => {
                const cs = counts(w, s.id);
                return (
                  <tr key={s.id} data-testid="student-row">
                    <td className="check-cell">
                      <input
                        type="checkbox"
                        aria-label={`选择${s.name}`}
                        checked={selected.includes(s.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, s.id]
                              : selected.filter((id) => id !== s.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Button className="student-name" onClick={() => openDetail(s)}>
                        <span className={`avatar avatar-${i % 5}`}>{s.name.slice(-2)}</span>
                        <strong>{s.name}</strong>
                      </Button>
                    </td>
                    <td className="student-number">{s.number}</td>
                    {w.categories.map((c) => (
                      <td key={c.id}>
                        <div className="counter">
                          <IconButton
                            label={`${s.name}${c.label}减一`}
                            disabled={busy || !cs[c.id]}
                            onClick={() => openDetail(s, c.id)}
                          >
                            <Minus size={13} />
                          </IconButton>
                          <span className={cs[c.id] ? `count-value ${c.color}` : 'zero'}>
                            {cs[c.id] || '—'}
                          </span>
                          <Button
                            aria-label={`${s.name}${c.label}加一`}
                            title={`登记一次${c.label}`}
                            disabled={busy}
                            onClick={() => add([s.id], c.id)}
                          >
                            <Plus size={13} />
                          </Button>
                        </div>
                      </td>
                    ))}
                    <td className="total-cell">
                      {Object.values(cs).reduce((a, b) => a + b, 0) || '—'}
                    </td>
                    <td>
                      <IconButton label={`查看${s.name}明细`} onClick={() => openDetail(s)}>
                        <ArrowUpRight size={15} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!shown.length && (
          <Empty
            icon={<Users size={30} />}
            title={w.students.length ? '没有找到同学' : '工作台还没有学生'}
            text={
              w.students.length ? '试试其他姓名或学号。' : '从左侧新建工作台，导入你的学生名单。'
            }
          />
        )}
      </div>
      <div className={`table-footer ${mobile ? 'mobile-table-footer' : ''}`}>
        <span>
          {shown.length} 位同学 · {total} 条有效记录
        </span>
        <span>＋ 登记 · − 选择记录撤销 · 次数为学期累计；“—”不等同于已确认出勤</span>
      </div>
      {student && (
        <StudentDetail
          student={student}
          category={category}
          session={context}
          readOnly={mobile}
          onClose={() => setStudent(null)}
        />
      )}
      {manual && (
        <RecordEditor
          initial={{ ...context, note }}
          onClose={() => setManual(false)}
          onSave={async (record) => {
            if (await update((w) => w.records.push(record), '考勤已补记')) {
              setLastIds([record.id]);
              setManual(false);
            }
          }}
        />
      )}
      {batch && (
        <Modal
          title="批量登记"
          subtitle={`为选中的 ${selected.length} 位同学登记相同课程、日期和备注。`}
          onClose={() => setBatch(false)}
        >
          <div className="batch-context">
            <strong>{context.courseName || '尚未选择课程'}</strong>
            <p>
              {context.date} · {context.time}
            </p>
          </div>
          <div className="category-actions">
            {w.categories.map((c) => (
              <Button disabled={busy} key={c.id} onClick={() => add(selected, c.id)}>
                <Tag color={c.color}>{c.label}</Tag>
                <Plus size={14} />
              </Button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
