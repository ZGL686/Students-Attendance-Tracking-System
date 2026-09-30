import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button, Empty } from '../../components/ui';
import type { Course } from '../../model';

const days = ['一', '二', '三', '四', '五', '六', '日'];
export function MobileAgenda({
  dates,
  courses,
  today,
  onOpen,
}: {
  dates: string[];
  courses: Course[];
  today: string;
  onOpen: (course: Course) => void;
}) {
  const [day, setDay] = useState(() => Math.max(0, dates.indexOf(today)));
  const daily = courses.filter((c) => c.day === day + 1).sort((a, b) => a.start - b.start);
  return (
    <section className="phone-agenda" aria-label="每日课程">
      <div className="phone-day-picker" role="tablist" aria-label="选择星期">
        {dates.map((date, index) => (
          <Button
            key={date}
            role="tab"
            aria-selected={day === index}
            aria-label={`周${days[index]} ${date}`}
            onClick={() => setDay(index)}
          >
            <span>{date === today ? '今天' : `周${days[index]}`}</span>
            <strong>{Number(date.slice(8))}</strong>
            <small>{courses.filter((c) => c.day === index + 1).length || '休'}</small>
          </Button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`周${days[day]}课程`}>
        <div className="phone-agenda-heading">
          <strong>{dates[day]}</strong>
          <span>{daily.length} 门课程</span>
        </div>
        {daily.map((c) => (
          <Button
            key={c.id}
            className={`mobile-agenda-course ${c.color}`}
            onClick={() => onOpen(c)}
          >
            <span className="phone-course-period">
              第 {c.start}–{c.end} 节
            </span>
            <strong>{c.name}</strong>
            <span>
              {c.room || '教室待定'} · {c.teacher || '教师待定'}
            </span>
          </Button>
        ))}
        {!daily.length && (
          <Empty
            icon={<BookOpen size={28} />}
            title="这一天没有课程"
            text="选择其他日期，或添加课程安排。"
          />
        )}
      </div>
    </section>
  );
}
