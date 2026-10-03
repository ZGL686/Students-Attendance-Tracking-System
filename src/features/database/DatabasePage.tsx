import { useState } from 'react';
import { Button, Modal, PageHeading } from '../../components/ui';
import type { DatabaseRow } from '../../database-engine';
import { writeCell } from '../../database-engine';
import type { CustomProperty, DatabaseKind } from '../../database-schema';
import { makeView } from '../../database-schema';
import { uid } from '../../model';
import { RecordEditor } from '../attendance/RecordEditor';

import { databaseActions } from './actions';
import { ValueEditor } from './Cells';
import { DatabaseDetail } from './DatabaseDetail';
import { DatabaseLayouts } from './DatabaseLayouts';
import { DatabaseToolbar } from './DatabaseToolbar';
import { layoutNames } from './labels';
import { NewStudent } from './NewStudent';
import { NewView } from './NewView';
import { PropertyEditor } from './PropertyEditor';
import { useDatabaseModel } from './useDatabaseModel';
import { ViewSettings } from './ViewSettings';
export function Database({ kind, mobile = false }: { kind: DatabaseKind; mobile?: boolean }) {
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<string>();
  const [propertyEditor, setPropertyEditor] = useState<CustomProperty | null | undefined>();
  const [newView, setNewView] = useState(false);
  const [newRow, setNewRow] = useState(false);
  const [peek, setPeek] = useState<{ kind: DatabaseKind; id: string }>();
  const [selected, setSelected] = useState<string[]>([]);
  const [batchProperty, setBatchProperty] = useState<string>();
  const model = useDatabaseModel(kind, query);
  const { w, view, rows, properties, update, busy } = model;
  const actions = databaseActions(model);
  const { saveView, saveProperty, deleteProperty, exportView } = actions;
  const open = (row: DatabaseRow) => setPeek({ kind, id: row.id });
  const activeSelected = selected.filter((id) => rows.some((r) => r.id === id));
  return (
    <>
      <PageHeading
        page={kind}
        description={
          kind === 'students'
            ? `${w.name} · ${w.students.length} 位同学`
            : '每一条登记，关联同学、课程与日期'
        }
      />
      <DatabaseToolbar
        model={model}
        query={query}
        setQuery={setQuery}
        setSelected={setSelected}
        setSettings={setSettings}
        setNewView={setNewView}
        setNewRow={setNewRow}
        exportView={exportView}
      />
      {!!activeSelected.length && (
        <div className="database-selection">
          <span>已选择 {activeSelected.length} 条</span>
          <select
            aria-label="批量编辑属性"
            value={batchProperty ?? ''}
            onChange={(e) => setBatchProperty(e.target.value || undefined)}
          >
            <option value="">编辑属性…</option>
            {properties
              .filter((p) => !p.readonly && p.type !== 'title' && p.id !== 'number')
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <Button className="text-button" onClick={() => setSelected([])}>
            取消选择
          </Button>
        </div>
      )}
      <DatabaseLayouts
        key={view.id}
        model={model}
        actions={actions}
        query={query}
        onOpen={open}
        onSettings={setSettings}
        onNew={setNewRow}
        tableProps={{
          mobile,
          model,
          actions,
          selected,
          setSelected,
          onOpen: open,
          onProperty: setPropertyEditor,
        }}
      />
      <div className="database-footer">
        <span>
          {rows.length} 条记录 · {layoutNames[view.layout]}视图
        </span>
        <span>
          {kind === 'students'
            ? '异常累计由有效考勤记录自动汇总'
            : '已撤销记录保留，可在筛选中显示'}{' '}
          · 设置随工作台保存
        </span>
      </div>
      {settings && (
        <ViewSettings
          key={`${view.id}-${settings}`}
          view={view}
          properties={properties}
          tab={settings}
          busy={busy}
          onSave={saveView}
          onClose={() => setSettings(undefined)}
          onProperty={(p) => {
            setSettings(undefined);
            setPropertyEditor(p ?? null);
          }}
        />
      )}
      {propertyEditor !== undefined && (
        <PropertyEditor
          initial={propertyEditor ?? undefined}
          busy={busy}
          onClose={() => setPropertyEditor(undefined)}
          onSave={saveProperty}
          onDelete={deleteProperty}
        />
      )}
      {newView && (
        <NewView
          onClose={() => setNewView(false)}
          onSave={async (name, layout) => {
            const v = makeView(uid(), name, layout);
            if (layout === 'board')
              v.groupBy = kind === 'students' ? 'custom:followup' : 'category';
            if (kind === 'records')
              v.filters = [{ id: uid(), property: 'voided', operator: 'equals', value: 'false' }];
            if (
              await update((w) => {
                w.databases[kind].views.push(v);
                w.databases[kind].activeViewId = v.id;
              }, '视图已创建')
            )
              setNewView(false);
          }}
        />
      )}
      {newRow &&
        (kind === 'students' ? (
          <NewStudent onClose={() => setNewRow(false)} />
        ) : (
          <RecordEditor
            initial={{}}
            onClose={() => setNewRow(false)}
            onSave={async (record) => {
              if (await update((w) => w.records.push(record), '考勤已补记')) setNewRow(false);
            }}
          />
        ))}
      {peek && (
        <DatabaseDetail
          key={`${peek.kind}-${peek.id}`}
          kind={peek.kind}
          id={peek.id}
          onClose={() => setPeek(undefined)}
          onNavigate={(kind, id) => setPeek({ kind, id })}
        />
      )}
      {batchProperty && (
        <Modal
          title={`批量编辑 · ${properties.find((p) => p.id === batchProperty)?.name}`}
          subtitle={`应用到选中的 ${activeSelected.length} 条记录`}
          onClose={() => setBatchProperty(undefined)}
        >
          <ValueEditor
            property={properties.find((p) => p.id === batchProperty)!}
            value={undefined}
            busy={busy}
            onCancel={() => setBatchProperty(undefined)}
            onSave={async (value) => {
              const ok = await update((w) => {
                const p = properties.find((p) => p.id === batchProperty)!;
                for (const id of activeSelected) writeCell(w, kind, id, p, value);
              }, '批量修改已保存');
              if (ok) setSelected([]);
              return ok;
            }}
          />
        </Modal>
      )}
    </>
  );
}
