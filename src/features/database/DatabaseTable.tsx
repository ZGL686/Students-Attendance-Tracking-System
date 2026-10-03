import { ArrowDownUp, FileText, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, IconButton } from '../../components/ui';
import type { DatabaseRow } from '../../database-engine';
import { calculate, displayValue } from '../../database-engine';
import type { CustomProperty } from '../../database-schema';

import type { DatabaseActions } from './actions';
import { CellDisplay, PropertyIcon, ValueEditor } from './Cells';
import { ColumnMenu } from './ColumnMenu';
import { calculationNames } from './labels';
import type { DatabaseModel } from './useDatabaseModel';
import { MobileDatabaseRows } from './MobileDatabaseRows';
export function DatabaseTable({
  mobile = false,
  model,
  actions,
  tableRows,
  selected,
  setSelected,
  onOpen: open,
  onProperty: setPropertyEditor,
}: {
  mobile?: boolean;
  model: DatabaseModel;
  actions: DatabaseActions;
  tableRows: DatabaseRow[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  onOpen: (row: DatabaseRow) => void;
  onProperty: (p: CustomProperty | null) => void;
}) {
  const { rows, columns, view, ordered, titleProperty, busy, db } = model;
  const { setValue, saveView } = actions;
  const [cell, setCell] = useState<{ rowId: string; property: string }>();
  const [columnMenu, setColumnMenu] = useState<string>();
  const columnAnchor = useRef<HTMLButtonElement>(null);
  const [dragTarget, setDragTarget] = useState('');
  if (mobile)
    return (
      <MobileDatabaseRows
        model={model}
        actions={actions}
        tableRows={tableRows}
        selected={selected}
        setSelected={setSelected}
        onOpen={open}
      />
    );
  return (
    <>
      <div className="database-table-scroll">
        <table className={`database-table ${view.wrap ? 'wrap' : ''}`}>
          <colgroup>
            <col style={{ width: 34 }} />
            {columns.map((p) => (
              <col
                key={p.id}
                style={{
                  width:
                    view.widths[p.id] ??
                    (p.type === 'title'
                      ? 210
                      : p.type === 'rollup'
                        ? 95
                        : p.id === 'number'
                          ? 170
                          : 160),
                }}
              />
            ))}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="db-check">
                <input
                  aria-label="选择当前视图全部记录"
                  type="checkbox"
                  checked={!!rows.length && rows.every((r) => selected.includes(r.id))}
                  onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                />
              </th>
              {columns.map((p) => (
                <th
                  key={p.id}
                  className={dragTarget === p.id ? 'drop-target' : ''}
                  onDragLeave={() => setDragTarget('')}
                  onDragOver={(e) => {
                    if (
                      p.type !== 'title' &&
                      e.dataTransfer.types.includes('application/guilu-property')
                    ) {
                      e.preventDefault();
                      setDragTarget(p.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragTarget('');
                    const source = e.dataTransfer.getData('application/guilu-property');
                    if (
                      !ordered.includes(source) ||
                      source === titleProperty.id ||
                      p.type === 'title'
                    )
                      return;
                    const order = ordered.filter((id) => id !== source);
                    order.splice(order.indexOf(p.id), 0, source);
                    void saveView({ ...view, order });
                  }}
                >
                  <Button
                    className="column-heading"
                    draggable={p.type !== 'title'}
                    onDragStart={(e) => e.dataTransfer.setData('application/guilu-property', p.id)}
                    onClick={(e) => {
                      columnAnchor.current = e.currentTarget;
                      setColumnMenu(p.id);
                    }}
                  >
                    <PropertyIcon type={p.type} />
                    {p.name}
                    {view.sorts.some((s) => s.property === p.id) && <ArrowDownUp size={12} />}
                  </Button>
                </th>
              ))}
              <th>
                <IconButton label="添加数据库属性" onClick={() => setPropertyEditor(null)}>
                  <Plus size={16} />
                </IconButton>
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => (
              <tr
                key={row.id}
                className={selected.includes(row.id) ? 'row-selected' : ''}
                data-testid="database-row"
              >
                <td className="db-check">
                  <input
                    type="checkbox"
                    aria-label={`选择${displayValue(row.values[titleProperty.id])}`}
                    checked={selected.includes(row.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, row.id]
                          : selected.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                {columns.map((p) => (
                  <td key={p.id} className={p.type === 'title' ? 'db-title-cell' : ''}>
                    {cell?.rowId === row.id && cell.property === p.id ? (
                      <ValueEditor
                        key={`${row.id}-${p.id}`}
                        property={p}
                        value={row.values[p.id]}
                        busy={busy}
                        onSave={(value) => setValue(row.id, p, value)}
                        onCancel={() => setCell(undefined)}
                      />
                    ) : p.type === 'title' ? (
                      <Button className="database-row-title" onClick={() => open(row)}>
                        <FileText size={16} />
                        {displayValue(row.values[p.id])}
                        <span>打开 ↗</span>
                      </Button>
                    ) : (
                      <Button
                        className="cell-button"
                        aria-label={`${displayValue(row.values[titleProperty.id])}的${p.name}`}
                        onClick={() =>
                          p.readonly ? open(row) : setCell({ rowId: row.id, property: p.id })
                        }
                      >
                        <CellDisplay value={row.values[p.id]} property={p} />
                      </Button>
                    )}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {columns.map((p) => (
                <td key={p.id}>
                  <div className="column-calculation">
                    <select
                      aria-label={`${p.name}列计算`}
                      value={view.calculations[p.id] ?? 'none'}
                      onChange={(e) =>
                        void saveView({
                          ...view,
                          calculations: {
                            ...view.calculations,
                            [p.id]: e.target.value as keyof typeof calculationNames,
                          },
                        })
                      }
                    >
                      {Object.entries(calculationNames)
                        .filter(
                          ([id]) =>
                            ['none', 'count', 'filled', 'unique'].includes(id) ||
                            p.type === 'number' ||
                            p.type === 'rollup',
                        )
                        .map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                    </select>
                    <span>{calculate(tableRows, p.id, view.calculations[p.id] ?? 'none')}</span>
                  </div>
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {columnMenu && columns.some((p) => p.id === columnMenu) && (
        <ColumnMenu
          key={columnMenu}
          property={columns.find((p) => p.id === columnMenu)!}
          view={view}
          anchor={columnAnchor}
          onSave={saveView}
          onClose={() => setColumnMenu(undefined)}
          onEdit={() => {
            setPropertyEditor(db.properties.find((p) => p.id === columnMenu) ?? null);
            setColumnMenu(undefined);
          }}
        />
      )}
    </>
  );
}
