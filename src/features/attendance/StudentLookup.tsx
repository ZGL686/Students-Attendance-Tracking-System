import { Search, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Button, Empty, PageHeading } from '../../components/ui';
import { useApp } from '../../context';
import { counts } from '../../model';
import type { Student } from '../../model';
import { LinkedDatabaseDetail as DatabaseDetail } from '../database/LinkedDatabaseDetail';
import { NewStudent } from '../database/NewStudent';

export function StudentLookup() {
  const { w } = useApp();
  const [query, setQuery] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const matches = w.students.filter(
    (item) => item.name.includes(query.trim()) || item.number.includes(query.trim()),
  );
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeading
        page="students"
        description={`${w.name} · ${w.students.length} 位同学`}
        actions={
          <Button className="primary" onClick={() => setAdding(true)}>
            添加学生
          </Button>
        }
      />
      <label className="mobile-student-search">
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="搜索同学"
          placeholder="输入姓名或学号"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="mobile-lookup-list">
        {matches.map((item) => {
          const totals = counts(w, item.id);
          const count = Object.values(totals).reduce((sum, value) => sum + value, 0);
          return (
            <article className="mobile-lookup-card" key={item.id}>
              <div className="mobile-lookup-identity">
                <span className="icon-tile">
                  <UserRound size={19} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.number}
                    {item.group ? ` · ${item.group}` : ''}
                  </small>
                </div>
                <Button className="text-button" onClick={() => setStudent(item)}>
                  {count} 条记录
                </Button>
              </div>
            </article>
          );
        })}
        {!matches.length && (
          <Empty
            icon={<UserRound size={30} />}
            title={w.students.length ? '没有找到同学' : '还没有导入学生名单'}
            text={
              w.students.length
                ? '检查姓名或学号后再试。'
                : '可直接添加学生，或从全部功能导入学生名单。'
            }
          />
        )}
      </div>
      {student && (
        <DatabaseDetail kind="students" id={student.id} onClose={() => setStudent(null)} />
      )}
      {adding && <NewStudent onClose={() => setAdding(false)} />}
    </>
  );
}
