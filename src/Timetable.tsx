import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  Settings2,
  UserRound,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton, Modal, PageHeading, Tag, TextLink } from './components/ui';
import { useApp } from './context';
import type { Course, Session } from './model';
import { coursesOn, formatWeeks, weekDates, weekOf } from './model';
import { MobileAgenda } from './features/timetable/MobileAgenda';
import { CourseEditor } from './features/timetable/CourseEditor';
import { ImportCourses } from './features/timetable-import/ImportCourses';
import { coursesOverlap } from './features/timetable-import/model';

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function Timetable({
  now,
  mobile = false,
  onAttendance,
  onSettings,
}: {
  now: { date: string; time: string };
  mobile?: boolean;
  onAttendance: (s?: Session) => void;
  onSettings: () => void;
}) {
  const { w, update, busy, notify } = useApp();
  const current = weekOf(w.startDate, now.date);
  const [selected, setSelected] = useState<number | null>(null);
  const [weekPicker, setWeekPicker] = useState(false);
  const [gridView, setGridView] = useState(mobile);
  const [detail, setDetail] = useState<Course | null>(null);
  const [editor, setEditor] = useState<Course | null | undefined>();
  const [importTarget, setImportTarget] = useState<string>();
  const week = selected ?? Math.max(1, Math.min(w.totalWeeks, current));
  const dates = weekDates(w, week);
  const courses = w.courses.filter((c) => c.weeks.includes(week));
  const today = coursesOn(w, now.date);
  const totalHours = courses.reduce((sum, c) => sum + c.end - c.start + 1, 0);
  return (
    <>
      <PageHeading
        page="schedule"
        description={`${w.term} · ${w.name}`}
        actions={
          <>
            <Button onClick={onSettings}>
              <Settings2 size={16} />
              学期设置
            </Button>
            <Button onClick={() => setImportTarget(w.id)}>
              <Upload size={16} />
              导入课程
            </Button>
            <Button className="primary" onClick={() => setEditor(null)}>
              <Plus size={16} />
              添加课程
            </Button>
          </>
        }
      />
      <div className="overview-strip">
        <div>
          <CalendarDays size={18} />
          <span>本周课程</span>
          <strong>
            {courses.length}
            <small>门次</small>
          </strong>
        </div>
        <div>
          <Clock3 size={18} />
          <span>本周课时</span>
          <strong>
            {totalHours}
            <small>节</small>
          </strong>
        </div>
        <div>
          <UserRound size={18} />
          <span>班级同学</span>
          <strong>
            {w.students.length}
            <small>人</small>
          </strong>
        </div>
        <div className="strip-note">
          <span className="green-dot" />
          按北京时间自动切换教学周
        </div>
      </div>
      <div className="schedule-layout">
        <section className="schedule-section">
          <div className="section-toolbar">
            <div className="week-navigation">
              <IconButton label="上一周" disabled={week <= 1} onClick={() => setSelected(week - 1)}>
                <ChevronLeft size={18} />
              </IconButton>
              <Button className="week-title" onClick={() => setWeekPicker(true)}>
                第 {week} 周 <span>⌄</span>
              </Button>
              <IconButton
                label="下一周"
                disabled={week >= w.totalWeeks}
                onClick={() => setSelected(week + 1)}
              >
                <ChevronRight size={18} />
              </IconButton>
              <span className="muted date-range">
                {dates[0].replaceAll('-', '.')} — {dates[6].slice(5).replace('-', '.')}
              </span>
            </div>
            <Button className="small" onClick={() => setSelected(null)}>
              回到本周
            </Button>
          </div>
          {(current < 1 || current > w.totalWeeks) && (
            <div className="inline-note">当前日期在学期范围之外，正在预览第 {week} 周。</div>
          )}
          {mobile && (
            <>
              <div className="mobile-view-switch" role="group" aria-label="课表浏览方式">
                <Button aria-pressed={!gridView} onClick={() => setGridView(false)}>
                  每日安排
                </Button>
                <Button aria-pressed={gridView} onClick={() => setGridView(true)}>
                  整周课表
                </Button>
              </div>
              {!gridView && (
                <MobileAgenda
                  key={dates[0]}
                  dates={dates}
                  courses={courses}
                  today={now.date}
                  onOpen={setDetail}
                />
              )}
            </>
          )}
          <div className={mobile && gridView ? 'phone-calendar-scroll' : undefined}>
            <div className="calendar" role="region" aria-label={`第 ${week} 周课表`}>
              <div className="calendar-corner">{Number(dates[0].slice(5, 7))} 月</div>
              {days.map((day, i) => (
                <div
                  key={day}
                  className={`day-heading ${dates[i] === now.date ? 'today' : ''} ${i > 4 ? 'weekend' : ''}`}
                >
                  <span>{day}</span>
                  <b>{Number(dates[i].slice(8))}</b>
                  {dates[i] === now.date && <i>今天</i>}
                </div>
              ))}
              {w.periods.map((p, i) => (
                <div key={i} className="period-label" style={{ gridColumn: 1, gridRow: i + 2 }}>
                  <b>{i + 1}</b>
                  <span>{p.start}</span>
                  <span>{p.end}</span>
                </div>
              ))}
              {Array.from({ length: 70 }, (_, i) => (
                <div
                  key={i}
                  className={`calendar-cell ${i % 7 > 4 ? 'weekend' : ''} ${dates[i % 7] === now.date ? 'today-col' : ''} ${Math.floor(i / 7) === 4 ? 'afternoon' : ''}`}
                  style={{ gridColumn: (i % 7) + 2, gridRow: Math.floor(i / 7) + 2 }}
                />
              ))}
              {courses.map((c) => (
                <Button
                  key={c.id}
                  className={`course-card ${c.color}`}
                  style={{ gridColumn: c.day + 1, gridRow: `${c.start + 1} / ${c.end + 2}` }}
                  onClick={() => setDetail(c)}
                  title={`${c.name} · ${c.room} · ${c.teacher}`}
                >
                  <strong>{c.name}</strong>
                  <span>{c.room.replace('韶师', '')}</span>
                  <small>
                    {c.teacher} · {c.start}–{c.end} 节
                  </small>
                </Button>
              ))}
            </div>
          </div>
          {!mobile && (
            <div className="calendar-footer">
              <span>
                <span className="tiny-square" />
                点击课程查看详情或开始考勤
              </span>
              <span>共 {w.totalWeeks} 个教学周</span>
            </div>
          )}
        </section>
        <aside className="daily-panel">
          <div className="daily-title">
            <span className="icon-tile">
              <CalendarDays size={19} />
            </span>
            <div>
              <h3>今日安排</h3>
              <p>
                {now.date.slice(5).replace('-', ' 月 ')} 日 ·{' '}
                {
                  days[
                    new Date(now.date + 'T00:00:00Z').getUTCDay() === 0
                      ? 6
                      : new Date(now.date + 'T00:00:00Z').getUTCDay() - 1
                  ]
                }
              </p>
            </div>
          </div>
          {today.length ? (
            today.map((c) => (
              <Button
                className="today-course"
                key={c.id}
                onClick={() =>
                  onAttendance({
                    date: now.date,
                    time: w.periods[c.start - 1].start,
                    courseId: c.id,
                    courseName: c.name,
                  })
                }
              >
                <span className={`color-line ${c.color}`} />
                <small>
                  {w.periods[c.start - 1].start} – {w.periods[c.end - 1].end}
                </small>
                <strong>{c.name}</strong>
                <span>{c.room.replace('韶师', '')}</span>
                <ArrowRight size={14} />
              </Button>
            ))
          ) : (
            <div className="day-off">
              <div className="rest-illustration">
                <BookOpen size={42} strokeWidth={1.1} />
                <span>✦</span>
              </div>
              <h3>今天没有课程</h3>
              <p>
                给忙碌的学习生活
                <br />
                留一点空白。
              </p>
            </div>
          )}
          <Button className="full-width" onClick={() => onAttendance()}>
            前往考勤台
            <ArrowRight size={15} />
          </Button>
          <div className="aside-divider" />
          <div className="aside-heading">
            <BookOpen size={16} />
            <h4>学期备忘</h4>
          </div>
          <p className="memo">{w.notes || '暂无备忘，可在学期设置中添加。'}</p>
          <TextLink onClick={onSettings}>管理学期信息</TextLink>
          <div className="local-tip">
            <Check size={15} />
            <span>每一次记录，自动保存在本机。</span>
          </div>
        </aside>
      </div>
      {weekPicker && (
        <Modal
          title="查看周课表"
          subtitle={`第 1 周从 ${w.startDate} 所在周开始`}
          onClose={() => setWeekPicker(false)}
        >
          <div className="week-grid">
            {Array.from({ length: w.totalWeeks }, (_, i) => (
              <Button
                key={i}
                className={week === i + 1 ? 'selected' : ''}
                onClick={() => {
                  setSelected(i + 1);
                  setWeekPicker(false);
                }}
              >
                {i + 1 === current ? '本周' : `第 ${i + 1} 周`}
              </Button>
            ))}
          </div>
        </Modal>
      )}
      {detail && (
        <Modal
          title={detail.name}
          subtitle={`第 ${formatWeeks(detail.weeks)} 周`}
          onClose={() => setDetail(null)}
        >
          <div className="course-detail">
            <p>
              <Clock3 size={17} />
              {days[detail.day - 1]} · 第 {detail.start}–{detail.end} 节 ·{' '}
              {w.periods[detail.start - 1].start}–{w.periods[detail.end - 1].end}
            </p>
            <p>
              <MapPin size={17} />
              {detail.room || '教室待定'}
            </p>
            <p>
              <UserRound size={17} />
              {detail.teacher || '教师待定'}
            </p>
            <Tag color={detail.color}>{dates[detail.day - 1]}</Tag>
          </div>
          <div className="modal-actions">
            {
              <Button
                onClick={() => {
                  setEditor(detail);
                  setDetail(null);
                }}
              >
                编辑课程
              </Button>
            }
            <Button
              className="primary"
              onClick={() => {
                onAttendance({
                  date: dates[detail.day - 1],
                  time: w.periods[detail.start - 1].start,
                  courseId: detail.id,
                  courseName: detail.name,
                });
                setDetail(null);
              }}
            >
              为这节课记考勤
              <ArrowRight size={15} />
            </Button>
          </div>
        </Modal>
      )}
      {editor !== undefined && (
        <CourseEditor
          initial={editor}
          totalWeeks={w.totalWeeks}
          onClose={() => setEditor(undefined)}
          onSave={async (c) => {
            const overlap = w.courses.find((x) => x.id !== c.id && coursesOverlap(x, c));
            if (overlap) {
              notify(`与“${overlap.name}”的节次和周次重叠，请调整。`, true);
              return false;
            }
            const ok = await update((w) => {
              if (c.weeks.some((week) => week > w.totalWeeks))
                throw new Error(`上课周次不能超过当前学期的 ${w.totalWeeks} 周。`);
              const conflict = w.courses.find((x) => x.id !== c.id && coursesOverlap(x, c));
              if (conflict) throw new Error(`与“${conflict.name}”的节次和周次重叠，请调整。`);
              const i = w.courses.findIndex((x) => x.id === c.id);
              if (i < 0) w.courses.push(c);
              else w.courses[i] = c;
            }, '课程已保存');
            if (ok) setEditor(undefined);
            return ok;
          }}
          onDelete={
            editor
              ? async () => {
                  if (
                    await update((w) => {
                      w.courses = w.courses.filter((c) => c.id !== editor.id);
                    }, '课程已移除，已有考勤明细仍保留')
                  )
                    setEditor(undefined);
                }
              : undefined
          }
          busy={busy}
        />
      )}
      {importTarget && (
        <ImportCourses targetId={importTarget} onClose={() => setImportTarget(undefined)} />
      )}
    </>
  );
}
