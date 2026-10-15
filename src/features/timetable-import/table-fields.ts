const aliases = {
  name: ['课程名称', '课程名', '课程', '科目', 'name', 'course'],
  teacher: ['任课教师', '教师', '老师', 'teacher'],
  room: ['教室', '上课地点', '地点', 'room', 'location'],
  day: ['星期', '上课星期', '星期几', '周几', 'day', 'weekday'],
  start: ['开始节次', '起始节次', '开始节', 'start'],
  end: ['结束节次', '结束节', 'end'],
  periods: ['节次', '上课节次', '时间节次', 'periods'],
  weeks: ['上课周次', '教学周', '周次', '周数', 'weeks'],
};

export type TableField = keyof typeof aliases;
export type TableHeader = { row: number; columns: Partial<Record<TableField, number>> };
export const normalizeTableLabel = (text: string) => text.trim().replace(/\s+/g, '').toLowerCase();

/** The parser and file diagnostics share one field vocabulary. */
export function tableHeaders(
  cells: { row: number; column: number; text: string }[],
): TableHeader[] {
  const rows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b).slice(0, 30);
  return rows.map((row) => {
    const columns: TableHeader['columns'] = {};
    for (const cell of cells.filter((item) => item.row === row)) {
      const label = normalizeTableLabel(cell.text);
      for (const field of Object.keys(aliases) as TableField[])
        if (aliases[field].includes(label)) columns[field] = cell.column;
    }
    return { row, columns };
  });
}

export function hasSchedulingFields(columns: TableHeader['columns']): boolean {
  return ['day', 'weeks', 'periods', 'start', 'end'].some((field) => field in columns);
}
