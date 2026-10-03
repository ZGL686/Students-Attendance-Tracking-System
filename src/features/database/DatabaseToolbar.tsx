import {
  ArrowDownUp,
  ChevronDown,
  Columns3,
  Copy,
  Download,
  Filter as FilterIcon,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, IconButton, Popover } from '../../components/ui';
import { uid } from '../../model';

import { layoutIcons } from './labels';
import type { DatabaseModel } from './useDatabaseModel';
import { ImportStudentsButton } from './ImportStudents';
export function DatabaseToolbar({
  model,
  query,
  setQuery,
  setSelected,
  setSettings,
  setNewView,
  setNewRow,
  exportView,
}: {
  model: DatabaseModel;
  query: string;
  setQuery: (v: string) => void;
  setSelected: (v: string[]) => void;
  setSettings: (v: string) => void;
  setNewView: (v: boolean) => void;
  setNewRow: (v: boolean) => void;
  exportView: () => Promise<void>;
}) {
  const { view, db, rows, groupProperty, properties, busy, update, kind } = model;
  const [viewMenu, setViewMenu] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div className="database-toolbar">
        <div className="database-views" role="tablist" aria-label="数据库视图">
          {db.views.map((v) => {
            const Icon = layoutIcons[v.layout];
            return (
              <Button
                ref={v.id === view.id ? anchor : undefined}
                role="tab"
                aria-selected={v.id === view.id}
                className={v.id === view.id ? 'active' : ''}
                key={v.id}
                onClick={() => {
                  if (v.id === view.id) {
                    setViewMenu(!viewMenu);
                    return;
                  }
                  void update((w) => {
                    w.databases[kind].activeViewId = v.id;
                  }, '');
                  setSelected([]);
                  setViewMenu(false);
                }}
              >
                <Icon size={16} />
                {v.name}
                {v.id === view.id && <ChevronDown size={13} />}
              </Button>
            );
          })}
          <IconButton label="添加视图" onClick={() => setNewView(true)}>
            <Plus size={18} />
          </IconButton>
        </div>
        <div className="database-tools">
          <IconButton
            label="数据库筛选"
            className={`${view.filters.length ? 'tool-active' : ''}`}
            onClick={() => setSettings('filter')}
          >
            <FilterIcon size={17} />
          </IconButton>
          <IconButton
            label="数据库排序"
            className={`${view.sorts.length ? 'tool-active' : ''}`}
            onClick={() => setSettings('sort')}
          >
            <ArrowDownUp size={17} />
          </IconButton>
          <IconButton
            label="数据库分组"
            className={`${view.groupBy ? 'tool-active' : ''}`}
            onClick={() => setSettings('group')}
          >
            <Columns3 size={17} />
          </IconButton>
          <div className="database-search">
            <Search size={16} />
            <input
              aria-label="搜索数据库"
              placeholder="搜索"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected([]);
              }}
            />
          </div>
          <IconButton
            label="数据库属性"

            onClick={() => setSettings('properties')}
          >
            <SlidersHorizontal size={17} />
          </IconButton>
          <IconButton
            label="导出当前视图"

            onClick={() => void exportView()}
          >
            <Download size={17} />
          </IconButton>
          {kind === 'students' && <ImportStudentsButton />}
          <Button className="primary new-row-button" onClick={() => setNewRow(true)}>
            新建
            <ChevronDown size={13} />
          </Button>
        </div>
      </div>
      {viewMenu && (
        <Popover
          anchor={anchor}
          className="view-menu"
          label="视图操作"
          onClose={() => setViewMenu(false)}
        >
          <Button
            onClick={() => {
              setSettings('layout');
              setViewMenu(false);
            }}
          >
            <SlidersHorizontal size={15} />
            编辑视图
          </Button>
          <Button
            disabled={busy || db.views.length >= 30}
            onClick={async () => {
              const copy = {
                ...structuredClone(view),
                id: uid(),
                name: `${view.name.slice(0, 44)} 副本`,
              };
              if (
                await update((w) => {
                  const db = w.databases[kind];
                  db.views.push(copy);
                  db.activeViewId = copy.id;
                }, '视图已复制')
              )
                setViewMenu(false);
            }}
          >
            <Copy size={15} />
            复制视图
          </Button>
          <Button
            disabled={busy || db.views.length <= 1}
            onClick={async () => {
              if (
                await update((w) => {
                  const db = w.databases[kind];
                  db.views = db.views.filter((v) => v.id !== view.id);
                  db.activeViewId = db.views[0].id;
                }, '已删除视图，原始数据保留')
              )
                setViewMenu(false);
            }}
          >
            <Trash2 size={15} />
            删除视图
          </Button>
          <Button onClick={() => setViewMenu(false)}>
            <X size={15} />
            关闭
          </Button>
        </Popover>
      )}
      {(view.filters.length > 0 || view.sorts.length > 0 || view.groupBy) && (
        <div className="database-chips">
          {view.filters.map((f) => (
            <Button key={f.id} onClick={() => setSettings('filter')}>
              <FilterIcon size={12} />
              {properties.find((p) => p.id === f.property)?.name}{' '}
              {f.operator === 'equals'
                ? '='
                : f.operator === 'gt'
                  ? '>'
                  : f.operator === 'empty'
                    ? '为空'
                    : f.operator === 'notEmpty'
                      ? '不为空'
                      : f.operator === 'contains'
                        ? '包含'
                        : '·'}{' '}
              {properties.find((p) => p.id === f.property)?.labels?.[f.value] ??
                (f.value === 'false' ? '否' : f.value === 'true' ? '是' : f.value)}
            </Button>
          ))}
          {view.sorts.length > 0 && (
            <Button onClick={() => setSettings('sort')}>
              <ArrowDownUp size={13} />
              {view.sorts.length} 项排序
            </Button>
          )}
          {view.groupBy && (
            <Button onClick={() => setSettings('group')}>
              <Columns3 size={13} />
              {groupProperty?.name}
            </Button>
          )}
          <span className="muted">{rows.length} 条</span>
        </div>
      )}
    </>
  );
}
