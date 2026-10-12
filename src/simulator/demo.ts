import { addDays, beijingNow, dataSchema, monday, newWorkspace } from '../model';
import type { AppData, Course } from '../model';

export function createSimulatorData(): AppData {
  const workspace = newWorkspace('山水课堂 · 演示');
  workspace.term = '示例学期';
  workspace.startDate = addDays(monday(beijingNow().date), -35);
  workspace.totalWeeks = 18;
  workspace.notes = '';
  const courses: [string, number, number, Course['color']][] = [
    ['程序设计', 1, 1, 'blue'],
    ['界面设计', 1, 3, 'teal'],
    ['数字媒体', 2, 3, 'purple'],
    ['中国美术', 2, 5, 'green'],
    ['交互设计', 3, 1, 'teal'],
    ['影像基础', 3, 5, 'amber'],
    ['网页设计', 4, 3, 'blue'],
    ['创意实践', 4, 7, 'pink'],
    ['设计基础', 5, 1, 'purple'],
    ['体育活动', 5, 3, 'green'],
  ];
  workspace.courses = courses.map(([name, day, start, color], index) => ({
    id: `sim-course-${index + 1}`,
    name,
    teacher: '示例教师',
    room: `示例${index % 2 ? 'B201' : 'A101'}`,
    day,
    start,
    end: start + 1,
    color,
    weeks: Array.from({ length: 18 }, (_, week) => week + 1),
  }));
  return dataSchema.parse({
    schemaVersion: 3,
    activeWorkspaceId: workspace.id,
    workspaces: [workspace],
  });
}

/** Preview-only cleanup; the caller saves a new snapshot and retains the old one. */
export function removeSimulatorStudents(data: AppData): AppData | null {
  const removedByWorkspace = data.workspaces.map(
    (workspace) =>
      new Set(
        workspace.students
          .filter((student) =>
            ['甲', '乙', '丙'].some(
              (suffix, index) =>
                student.id === `sim-student-${index + 1}` &&
                student.number === `SIM-00${index + 1}` &&
                student.name === `示例同学${suffix}`,
            ),
          )
          .map((student) => student.id),
      ),
  );
  if (!removedByWorkspace.some((ids) => ids.size)) return null;
  const next = structuredClone(data);
  next.workspaces.forEach((workspace, index) => {
    const students = removedByWorkspace[index];
    const records = new Set(
      workspace.records
        .filter((record) => students.has(record.studentId))
        .map((record) => record.id),
    );
    workspace.students = workspace.students.filter((student) => !students.has(student.id));
    workspace.records = workspace.records.filter((record) => !records.has(record.id));
    for (const id of students) delete workspace.databases.students.cells[id];
    for (const id of records) delete workspace.databases.records.cells[id];
  });
  return dataSchema.parse(next);
}
