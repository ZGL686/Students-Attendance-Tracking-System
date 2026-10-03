import { useState } from 'react';
import { Button } from '../../components/ui';
import { calculate, displayValue } from '../../database-engine';
import type { DatabaseRow } from '../../database-engine';
import { CellDisplay, ValueEditor } from './Cells';
import type { DatabaseActions } from './actions';
import type { DatabaseModel } from './useDatabaseModel';
import { calculationNames } from './labels';

export function MobileDatabaseRows({
  model,
  actions,
  tableRows,
  selected,
  setSelected,
  onOpen,
}: {
  model: DatabaseModel;
  actions: DatabaseActions;
  tableRows: DatabaseRow[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  onOpen: (row: DatabaseRow) => void;
}) {
  const { columns, titleProperty, busy, view } = model;
  const [cell, setCell] = useState<{ rowId: string; property: string }>();
  const allSelected = tableRows.length > 0 && tableRows.every((row) => selected.includes(row.id));
  return (
    <div className="phone-database-rows">
      <label className="check-label phone-database-select-all">
        <input
          type="checkbox"
          checked={allSelected}
          aria-label="选择本组全部记录"
          onChange={(event) =>
            setSelected(
              event.target.checked
                ? [...new Set([...selected, ...tableRows.map((row) => row.id)])]
                : selected.filter((id) => !tableRows.some((row) => row.id === id)),
            )
          }
        />
        选择本组全部记录 · {tableRows.length} 条
      </label>
      {tableRows.map((row) => (
        <article
          className={`phone-database-row ${selected.includes(row.id) ? 'row-selected' : ''}`}
          key={row.id}
        >
          <header>
            <label className="phone-student-select">
              <input
                type="checkbox"
                aria-label={`选择${displayValue(row.values[titleProperty.id])}`}
                checked={selected.includes(row.id)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...new Set([...selected, row.id])]
                      : selected.filter((id) => id !== row.id),
                  )
                }
              />
            </label>
            <Button onClick={() => onOpen(row)}>
              {displayValue(row.values[titleProperty.id])}
              <small>查看 / 编辑</small>
            </Button>
          </header>
          <dl className="phone-database-properties">
            {columns
              .filter((property) => property.type !== 'title')
              .map((property) => (
                <div key={property.id}>
                  <dt>{property.name}</dt>
                  <dd>
                    {cell?.rowId === row.id && cell.property === property.id ? (
                      <ValueEditor
                        property={property}
                        value={row.values[property.id]}
                        busy={busy}
                        onSave={(value) => actions.setValue(row.id, property, value)}
                        onCancel={() => setCell(undefined)}
                      />
                    ) : (
                      <Button
                        className="cell-button"
                        aria-label={`${displayValue(row.values[titleProperty.id])}的${property.name}`}
                        onClick={() =>
                          property.readonly
                            ? onOpen(row)
                            : setCell({ rowId: row.id, property: property.id })
                        }
                      >
                        <CellDisplay property={property} value={row.values[property.id]} />
                      </Button>
                    )}
                  </dd>
                </div>
              ))}
          </dl>
        </article>
      ))}
      <div className="phone-database-calculations">
        {columns.map((property) => (
          <label key={property.id}>
            <span>{property.name}</span>
            <select
              aria-label={`${property.name}列计算`}
              value={view.calculations[property.id] ?? 'none'}
              onChange={(event) =>
                void actions.saveView({
                  ...view,
                  calculations: {
                    ...view.calculations,
                    [property.id]: event.target.value as keyof typeof calculationNames,
                  },
                })
              }
            >
              {Object.entries(calculationNames)
                .filter(
                  ([id]) =>
                    ['none', 'count', 'filled', 'unique'].includes(id) ||
                    property.type === 'number' ||
                    property.type === 'rollup',
                )
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
            <strong>
              {calculate(tableRows, property.id, view.calculations[property.id] ?? 'none')}
            </strong>
          </label>
        ))}
      </div>
    </div>
  );
}
