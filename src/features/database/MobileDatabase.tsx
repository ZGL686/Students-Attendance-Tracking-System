import { useState } from 'react';
import { Button } from '../../components/ui';
import type { DatabaseKind } from '../../database-schema';
import { StudentLookup } from '../attendance/StudentLookup';
import { RecordHistory } from '../attendance/RecordHistory';
import { Database } from './DatabasePage';

export function MobileDatabase({ kind }: { kind: DatabaseKind }) {
  const [full, setFull] = useState(false);
  return (
    <>
      <div className="mobile-view-switch" role="group" aria-label="浏览方式">
        <Button aria-pressed={!full} onClick={() => setFull(false)}>
          便捷列表
        </Button>
        <Button aria-pressed={full} onClick={() => setFull(true)}>
          完整数据库
        </Button>
      </div>
      {full && <p className="phone-scroll-hint">左右滑动查看全部列，也可切换看板、画廊等视图。</p>}
      {full ? (
        <Database kind={kind} />
      ) : kind === 'students' ? (
        <StudentLookup />
      ) : (
        <RecordHistory />
      )}
    </>
  );
}
