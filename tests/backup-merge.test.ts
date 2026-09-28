import { describe, expect, it } from 'vitest';
import {
  dataSchema,
  newWorkspace,
  type AppData,
  type AttendanceRecord,
  type Student,
} from '../src/model';
import {
  initializePhoneFromWindows,
  isPristineMobileData,
  mergePhoneIntoWindows,
  recordConflictKey,
  syncWindowsToPhone,
} from '../src/features/backups/merge';

const student: Student = { id: 'student-a', name: '虚构同学', number: 'TEST001', group: '验收班' };
function record(id: string, note = ''): AttendanceRecord {
  return {
    id,
    studentId: student.id,
    category: 'late',
    date: '2026-09-28',
    time: '09:10',
    courseId: 'course-a',
    courseName: '虚构验收课',
    room: 'A101',
    teacher: '虚构教师',
    note,
    createdAt: '2026-09-28T01:10:00.000Z',
    updatedAt: '2026-09-28T01:10:00.000Z',
    voided: false,
  };
}
function workspace(name = '验收工作台') {
  return newWorkspace(name, [structuredClone(student)]);
}
function data(...workspaces: ReturnType<typeof workspace>[]): AppData {
  return dataSchema.parse({
    schemaVersion: 3,
    activeWorkspaceId: workspaces.find((item) => !item.deletedAt)!.id,
    workspaces,
  });
}

describe('manual phone backup merge', () => {
  it('initializes a blank phone with the exact Windows workspace and entity IDs', () => {
    const source = workspace('Windows 原工作台');
    source.courses.push({
      id: 'course-a',
      name: '虚构验收课',
      teacher: '虚构教师',
      room: 'A101',
      day: 1,
      start: 1,
      end: 2,
      weeks: [1],
      color: 'blue',
    });
    source.records.push(record('record-existing'));
    const imported = data(source);
    const blank = data(newWorkspace('请导入 Windows 备份'));

    expect(isPristineMobileData(blank)).toBe(true);
    const initialized = initializePhoneFromWindows(imported);
    expect(initialized.data).toEqual(imported);
    expect(initialized.data?.workspaces[0].id).toBe(source.id);
    expect(initialized.data?.workspaces[0].students[0].id).toBe(student.id);
    expect(initialized.data?.workspaces[0].records[0].id).toBe('record-existing');
  });

  it('adds phone-only records once and never deletes Windows records absent from the backup', () => {
    const windows = workspace();
    windows.records.push(record('windows-only'));
    const phone = structuredClone(windows);
    phone.records.push(record('phone-added'));
    const target = data(windows);
    const source = data(phone);

    const first = mergePhoneIntoWindows(target, source);
    expect(first.data?.workspaces[0].records.map((item) => item.id)).toEqual([
      'windows-only',
      'phone-added',
    ]);
    const second = mergePhoneIntoWindows(first.data!, source);
    expect(second.addedRecords).toBe(0);
    expect(second.unchangedRecords).toBe(2);
  });

  it('defaults record conflicts to Windows and accepts a per-record phone choice', () => {
    const windows = workspace();
    windows.records.push(record('same-record', 'Windows 备注'));
    const phone = structuredClone(windows);
    phone.records[0].note = '手机修改';
    phone.records[0].updatedAt = '2026-09-28T02:00:00.000Z';
    const target = data(windows);
    const source = data(phone);
    const key = recordConflictKey(windows.id, phone.records[0].id);

    const defaultResult = mergePhoneIntoWindows(target, source);
    expect(defaultResult.conflicts).toHaveLength(1);
    expect(defaultResult.data?.workspaces[0].records[0].note).toBe('Windows 备注');
    const selectedPhone = mergePhoneIntoWindows(target, source, { [key]: 'phone' });
    expect(selectedPhone.data?.workspaces[0].records[0].note).toBe('手机修改');
  });

  it('blocks a phone backup whose workspace ID does not exist in Windows', () => {
    const windows = data(workspace('Windows 工作台'));
    const phone = data(workspace('另一个工作台'));
    const result = mergePhoneIntoWindows(windows, phone);
    expect(result.data).toBeNull();
    expect(result.issues.join(' ')).toContain('找不到 Windows 工作台');
  });

  it('refreshes Android roster and courses from Windows while keeping phone-only attendance', () => {
    const phone = workspace('旧名称');
    phone.records.push(record('phone-only'));
    const windows = structuredClone(phone);
    windows.name = 'Windows 新名称';
    windows.students[0].name = 'Windows 更新姓名';
    windows.courses.push({
      id: 'course-a',
      name: 'Windows 更新课程',
      teacher: '虚构教师',
      room: 'A101',
      day: 1,
      start: 1,
      end: 2,
      weeks: [1],
      color: 'blue',
    });
    windows.records.push(record('windows-added'));

    const result = syncWindowsToPhone(data(phone), data(windows));
    expect(result.issues).toEqual([]);
    expect(result.data?.workspaces[0].name).toBe('Windows 新名称');
    expect(result.data?.workspaces[0].students[0].name).toBe('Windows 更新姓名');
    expect(result.data?.workspaces[0].courses[0].name).toBe('Windows 更新课程');
    expect(result.data?.workspaces[0].records.map((item) => item.id)).toEqual([
      'phone-only',
      'windows-added',
    ]);
  });

  it('resolves an Android record collision to Windows by default and preserves a chosen phone value', () => {
    const phone = workspace();
    phone.records.push(record('same-record', '手机修改'));
    phone.records[0].updatedAt = '2026-09-28T02:00:00.000Z';
    const windows = structuredClone(phone);
    windows.records[0].note = 'Windows 版本';
    windows.records[0].updatedAt = '2026-09-28T03:00:00.000Z';
    const target = data(phone);
    const source = data(windows);
    const key = recordConflictKey(phone.id, phone.records[0].id);

    const defaultResult = syncWindowsToPhone(target, source);
    expect(defaultResult.data?.workspaces[0].records[0].note).toBe('Windows 版本');
    const selectedPhone = syncWindowsToPhone(target, source, { [key]: 'phone' });
    expect(selectedPhone.data?.workspaces[0].records[0].note).toBe('手机修改');
  });
});
