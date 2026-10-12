import { describe, expect, it } from 'vitest';
import { initialData } from '../src/seed';
import { dataSchema, newWorkspace } from '../src/model';
import {
  commitAutomaticCourseImport,
  commitCourseImport,
  importFingerprint,
} from '../src/features/timetable-import/commit';
import { createEmptyDraft } from '../src/features/timetable-import/model';
import type { CourseDraft } from '../src/features/timetable-import/model';

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

describe('automatic append inside the latest save transaction', () => {
  it('appends complete courses, skips conflicts and duplicates, and preserves all existing data', () => {
    const data = initialData([{ id: 's1', number: 'T001', name: '虚构学生', group: '' }]);
    const workspace = data.workspaces[0];
    workspace.records.push({
      id: 'history',
      studentId: 's1',
      category: 'late',
      date: '2026-09-08',
      time: '08:00',
      courseId: workspace.courses[0].id,
      courseName: '虚构历史课程',
      teacher: '虚构教师',
      room: '历史教室',
      note: '历史备注',
      createdAt: '',
      updatedAt: '',
      voided: false,
    });
    const before = structuredClone(workspace);
    const first = draft();
    const result = commitAutomaticCourseImport(data, workspace.id, [
      first,
      { ...draft(), name: first.name },
      { ...draft(), name: '冲突虚构课' },
      { ...draft(), name: '不完整虚构课', start: '' },
    ]);
    expect(result).toMatchObject({
      imported: 1,
      duplicates: 1,
      inferredWeeks: 0,
      totalWeeks: 20,
      warnings: [],
    });
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.join()).toContain('重叠');
    expect(workspace.courses.slice(0, before.courses.length)).toEqual(before.courses);
    expect({ ...workspace, courses: before.courses }).toEqual(before);
    expect(dataSchema.parse(data)).toEqual(data);
  });

  it('fills absent grid weeks using the latest term and leaves the input drafts unchanged', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const raw: CourseDraft = { ...draft(), weeks: '', layout: 'grid' };
    const before = structuredClone(raw);
    workspace.totalWeeks = 13;
    const result = commitAutomaticCourseImport(data, workspace.id, [raw]);
    expect(workspace.courses.at(-1)?.weeks).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    expect(result).toMatchObject({ imported: 1, inferredWeeks: 1, totalWeeks: 13 });
    expect(result.warnings.join()).toContain('1–13 周');
    expect(raw).toEqual(before);
    const repeated = commitAutomaticCourseImport(data, workspace.id, [raw]);
    expect(repeated).toMatchObject({ imported: 0, duplicates: 1, inferredWeeks: 0, warnings: [] });
  });

  it('counts only saved inferred courses, including regenerated conflicting IDs', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const result = commitAutomaticCourseImport(data, workspace.id, [
      { ...draft(), id: workspace.courses[0].id, weeks: '', layout: 'grid' },
      {
        ...draft(),
        name: '虚构低置信课程',
        weeks: '',
        layout: 'grid',
        fieldConfidence: { name: 60 },
      },
    ]);
    expect(result).toMatchObject({ imported: 1, inferredWeeks: 1 });
    expect(result.skipped).toHaveLength(1);
    expect(workspace.courses.at(-1)?.id).not.toBe(workspace.courses[0].id);
  });

  it('preserves explicit parity weeks and rejects absent weeks on non-grid drafts', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const result = commitAutomaticCourseImport(data, workspace.id, [
      { ...draft(), layout: 'grid' },
      { ...draft(), name: '虚构列表缺周次', weeks: '', layout: 'list' },
      { ...draft(), name: '虚构文本缺周次', weeks: '', layout: 'text' },
    ]);
    expect(result).toMatchObject({ imported: 1, inferredWeeks: 0, warnings: [] });
    expect(result.skipped).toHaveLength(2);
    expect(workspace.courses.at(-1)?.weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it.each(['name', 'day', 'periods'] as const)(
    'skips low-confidence required %s without suppressing a good course',
    (field) => {
      const data = initialData();
      const workspace = data.workspaces[0];
      const result = commitAutomaticCourseImport(data, workspace.id, [
        { ...draft(), name: '虚构不可靠课', fieldConfidence: { [field]: 74 } },
        { ...draft(), name: '虚构可靠课', fieldConfidence: { name: 75, day: 75, periods: 75 } },
      ]);
      expect(result).toMatchObject({ imported: 1, duplicates: 0 });
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toContain('置信度');
      expect(workspace.courses.at(-1)?.name).toBe('虚构可靠课');
    },
  );

  it('keeps a course but blanks low-confidence optional fields and reports both omissions', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const raw = {
      ...draft(),
      fieldConfidence: { teacher: 74, room: 20, name: 95, day: 95, periods: 95 },
    };
    const before = structuredClone(raw);
    const result = commitAutomaticCourseImport(data, workspace.id, [raw]);
    expect(result.imported).toBe(1);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join()).toContain('任课教师');
    expect(result.warnings.join()).toContain('教室');
    expect(workspace.courses.at(-1)).toMatchObject({ teacher: '', room: '' });
    expect(raw).toEqual(before);
  });

  it('preserves legacy drafts without field confidence and accepted boundary-confidence optional fields', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const result = commitAutomaticCourseImport(data, workspace.id, [
      { ...draft(), confidence: 40 },
      { ...draft(), name: '虚构边界课程', day: '6', fieldConfidence: { teacher: 75, room: 75 } },
    ]);
    expect(result).toMatchObject({ imported: 2, warnings: [] });
    for (const course of workspace.courses.slice(-2))
      expect(course).toMatchObject({ teacher: '虚构教师', room: '测试室' });
  });

  it('skips blocking issues and does not mutate the workspace when no complete course remains', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const before = structuredClone(data);
    expect(() =>
      commitAutomaticCourseImport(data, workspace.id, [
        { ...draft(), blockingIssues: ['课程格横跨星期边界'] },
      ]),
    ).toThrow('未识别到可保存');
    expect(data).toEqual(before);
    const result = commitAutomaticCourseImport(data, workspace.id, [
      { ...draft(), blockingIssues: ['课程格横跨星期边界'] },
      { ...draft(), name: '虚构完整课程' },
    ]);
    expect(result.skipped.join()).toContain('课程格横跨星期边界');
    expect(result.imported).toBe(1);
  });

  it('rejects switched or deleted destinations before any mutation', () => {
    const data = initialData();
    const workspace = data.workspaces[0];
    const other = newWorkspace('另一虚构工作台');
    data.workspaces.push(other);
    data.activeWorkspaceId = other.id;
    const before = structuredClone(data);
    expect(() => commitAutomaticCourseImport(data, workspace.id, [draft()])).toThrow(
      '已切换或删除',
    );
    expect(data).toEqual(before);
    data.activeWorkspaceId = workspace.id;
    workspace.deletedAt = '2026-10-12T00:00:00.000Z';
    const deleted = structuredClone(data);
    expect(() => commitAutomaticCourseImport(data, workspace.id, [draft()])).toThrow(
      '已切换或删除',
    );
    expect(data).toEqual(deleted);
  });
});
