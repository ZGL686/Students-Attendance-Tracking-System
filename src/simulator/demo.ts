import { addDays, beijingNow, dataSchema, monday, newWorkspace } from '../model';
import type { AppData, Course } from '../model';

export function createSimulatorData(): AppData {
  const workspace = newWorkspace('山水课堂 · 演示');
  workspace.term = '示例学期';
  workspace.startDate = addDays(monday(beijingNow().date), -35);
  workspace.totalWeeks = 18;
  workspace.notes = '';
  workspace.students = ['甲', '乙', '丙'].map((suffix, index) => ({
    id: `sim-student-${index + 1}`,
    number: `SIM-00${index + 1}`,
    name: `示例同学${suffix}`,
    group: '演示组',
  }));
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
