import { useState } from 'react';
import type { DatabaseKind } from '../../database-schema';
import { DatabaseDetail } from './DatabaseDetail';

export function LinkedDatabaseDetail({
  kind,
  id,
  onClose,
}: {
  kind: DatabaseKind;
  id: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState({ kind, id });
  return (
    <DatabaseDetail
      key={`${target.kind}-${target.id}`}
      {...target}
      onClose={onClose}
      onNavigate={(nextKind, nextId) => setTarget({ kind: nextKind, id: nextId })}
    />
  );
}
