import {
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  Database,
  Settings2,
  Table2,
  Users,
} from 'lucide-react';

// One definition feeds the sidebar, breadcrumbs and page headings.
export const pages = {
  schedule: { title: '课程表', icon: CalendarDays },
  attendance: { title: '考勤工作台', icon: ClipboardCheck },
  students: { title: '学生数据库', icon: Users },
  records: { title: '考勤记录', icon: Table2 },
  reports: { title: '考勤汇总', icon: ChartNoAxesCombined },
  backups: { title: '数据与备份', icon: Database },
  settings: { title: '设置与偏好', icon: Settings2 },
} as const;
export type PageId = keyof typeof pages;
export const primaryPages: PageId[] = [
  'schedule',
  'attendance',
  'students',
  'records',
  'reports',
  'backups',
];
export const mobileTitles: Partial<Record<PageId, string>> = {
  schedule: '课表',
  attendance: '考勤',
  students: '学生',
  records: '记录',
  backups: '备份',
};
export const mobilePages: PageId[] = ['schedule', 'attendance', 'students', 'records', 'backups'];
