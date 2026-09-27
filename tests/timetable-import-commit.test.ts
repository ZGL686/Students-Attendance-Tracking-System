import { describe, expect, it } from 'vitest';
import { initialData } from '../src/seed';
import { newWorkspace } from '../src/model';
import { commitCourseImport, importFingerprint } from '../src/features/timetable-import/commit';
import { createEmptyDraft } from '../src/features/timetable-import/model';

const draft = () => ({
  ...createEmptyDraft('虚构测试'),
  name: '星际绘画',
  teacher: '虚构教师',
  room: '测试室',
  day: '7',
  start: '9',
  end: '10',
  weeks: '1-16双周',
});

describe('atomic course import', () => {
  it('replaces only the target courses while retaining student and attendance snapshots', () => {
    const data = initialData([{ id: 's1', number: 'T001', name: '虚构学生', group: '' }]);
    const workspace = data.workspaces[0];
    workspace.records.push({
      id: 'r1',
      studentId: 's1',
      category: 'late',
      date: '2026-09-08',
      time: '08:00',
      courseId: workspace.courses[0].id,
      courseName: '历史课程快照',
      teacher: '历史教师',
      room: '历史教室',
      note: '',
      createdAt: '',
      updatedAt: '',
      voided: false,
    });
    const preserved = structuredClone({ students: workspace.students, records: workspace.records });
    const result = commitCourseImport(
      data,
      workspace.id,
      [draft()],
      'replace',
      importFingerprint(workspace),
    );
    expect(result).toEqual({ imported: 1, duplicates: 0 });
    expect(workspace.courses).toHaveLength(1);
    expect(workspace.courses[0].weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect({ students: workspace.students, records: workspace.records }).toEqual(preserved);
  });

  it('rejects a changed or deleted destination and never falls through to the active workspace', () => {
    const data = initialData();
    const original = data.workspaces[0];
    const other = newWorkspace('另一个虚构工作台');
    data.workspaces.push(other);
    const snapshot = importFingerprint(original);
    data.activeWorkspaceId = other.id;
    expect(() => commitCourseImport(data, original.id, [draft()], 'append', snapshot)).toThrow(
      '已切换',
    );
    expect(other.courses).toEqual([]);
    original.deletedAt = new Date().toISOString();
    expect(() => commitCourseImport(data, original.id, [draft()], 'append', snapshot)).toThrow(
      '已被删除',
    );
  });

  it('requires fresh confirmation after the term or timetable changes', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const snapshot = importFingerprint(workspace);
    workspace.totalWeeks = 8;
    const before = structuredClone(workspace.courses);
    expect(() => commitCourseImport(data, workspace.id, [draft()], 'replace', snapshot)).toThrow(
      '已变化',
    );
    expect(() =>
      commitCourseImport(data, workspace.id, [draft()], 'replace', importFingerprint(workspace)),
    ).toThrow('8 周');
    expect(workspace.courses).toEqual(before);
  });

  it('rejects empty and conflicting imports without partially assigning valid drafts', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const before = structuredClone(workspace.courses);
    const first = draft();
    const conflict = { ...draft(), name: '冲突绘画' };
    const fingerprint = importFingerprint(workspace);
    expect(() => commitCourseImport(data, workspace.id, [], 'replace', fingerprint)).toThrow(
      '至少选择',
    );
    expect(() =>
      commitCourseImport(data, workspace.id, [first, conflict], 'append', fingerprint),
    ).toThrow('重叠');
    expect(workspace.courses).toEqual(before);
  });
});
