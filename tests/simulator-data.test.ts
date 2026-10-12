import { describe, expect, it } from 'vitest';
import type { AppData, AttendanceRecord, Student, Workspace } from '../src/model';
import { dataSchema, newWorkspace } from '../src/model';
import { createSimulatorData, removeSimulatorStudents } from '../src/simulator/demo';

const originalStudents: Student[] = ['甲', '乙', '丙'].map((suffix, index) => ({
  id: `sim-student-${index + 1}`,
  number: `SIM-00${index + 1}`,
  name: `示例同学${suffix}`,
  group: '演示组',
}));

const manualStudent: Student = {
  id: 'manual-student',
  number: 'MANUAL-001',
  name: '虚构手动同学',
  group: '手动组',
};

function workspace(id: string, students: Student[]): Workspace {
  const value = newWorkspace(`虚构工作台 ${id}`, structuredClone(students));
  value.id = id;
  value.notes = '应保留的虚构工作台备注';
  value.courses = structuredClone(createSimulatorData().workspaces[0].courses);
  for (const kind of ['students', 'records'] as const)
    value.databases[kind].properties.push({
      id: 'custom:simulator-note',
      name: '虚构验收备注',
      type: 'text',
      options: [],
    });
  value.records = students.map((student, index): AttendanceRecord => ({
    id: `${id}-record-${index}`,
    studentId: student.id,
    category: 'late',
    date: '2026-10-12',
    time: '08:10',
    courseId: value.courses[0].id,
    courseName: value.courses[0].name,
    room: value.courses[0].room,
    teacher: value.courses[0].teacher,
    note: '虚构记录备注',
    createdAt: '2026-10-12T00:10:00.000Z',
    updatedAt: '2026-10-12T00:10:00.000Z',
    voided: index % 2 === 1,
  }));
  for (const student of students)
    value.databases.students.cells[student.id] = { 'custom:simulator-note': '学生属性' };
  for (const record of value.records)
    value.databases.records.cells[record.id] = { 'custom:simulator-note': '记录属性' };
  return value;
}

function dataFor(workspaces: Workspace[]): AppData {
  return dataSchema.parse({
    schemaVersion: 3,
    activeWorkspaceId: workspaces[0].id,
    workspaces,
  });
}

describe('phone simulator example data', () => {
  it('starts with no students or attendance while retaining ten valid example courses', () => {
    const data = createSimulatorData();
    expect(dataSchema.parse(data)).toEqual(data);
    expect(data.workspaces).toHaveLength(1);
    expect(data.activeWorkspaceId).toBe(data.workspaces[0].id);
    expect(data.workspaces[0].students).toEqual([]);
    expect(data.workspaces[0].records).toEqual([]);
    expect(data.workspaces[0].courses).toHaveLength(10);
    expect(data.workspaces[0].databases.students.cells).toEqual({});
    expect(data.workspaces[0].databases.records.cells).toEqual({});
    expect(removeSimulatorStudents(data)).toBeNull();
  });

  it('removes original identities and related data from every workspace without mutating input', () => {
    const first = workspace('active', [...originalStudents, manualStudent]);
    first.students[0].group = '用户改过的分组';
    const second = workspace('inactive', [...originalStudents, manualStudent]);
    const archived = workspace('archived', [originalStudents[2], manualStudent]);
    archived.deletedAt = '2026-10-11T00:00:00.000Z';
    const untouched = workspace('untouched', [manualStudent]);
    const data = dataFor([first, second, archived, untouched]);
    const before = structuredClone(data);
    const expected = structuredClone(data);
    for (const value of expected.workspaces.slice(0, 3)) {
      const removedIds = new Set(originalStudents.map((student) => student.id));
      const removedRecords = value.records.filter((record) => removedIds.has(record.studentId));
      value.students = value.students.filter((student) => !removedIds.has(student.id));
      value.records = value.records.filter((record) => !removedIds.has(record.studentId));
      for (const id of removedIds) delete value.databases.students.cells[id];
      for (const record of removedRecords) delete value.databases.records.cells[record.id];
    }

    const cleaned = removeSimulatorStudents(data);
    expect(cleaned).not.toBeNull();
    expect(cleaned).toEqual(expected);
    expect(data).toEqual(before);
    expect(dataSchema.parse(cleaned)).toEqual(cleaned);
    expect(removeSimulatorStudents(cleaned!)).toBeNull();
  });

  it('preserves renamed, renumbered and manually added students with their records and cells', () => {
    const renamed = { ...originalStudents[0], name: '虚构改名同学' };
    const renumbered = { ...originalStudents[1], number: 'USER-002' };
    const added = { ...manualStudent, name: originalStudents[0].name };
    const first = workspace('changed', [renamed, renumbered, originalStudents[2], added]);
    const differentId = { ...originalStudents[0], id: 'manually-added-original-label' };
    const second = workspace('different-id', [differentId]);
    const data = dataFor([first, second]);
    const before = structuredClone(data);
    const expected = structuredClone(data);
    expected.workspaces[0].students.splice(2, 1);
    const [removedRecord] = expected.workspaces[0].records.splice(2, 1);
    delete expected.workspaces[0].databases.students.cells[originalStudents[2].id];
    delete expected.workspaces[0].databases.records.cells[removedRecord.id];

    const cleaned = removeSimulatorStudents(data);
    expect(cleaned).toEqual(expected);
    expect(data).toEqual(before);
    expect(dataSchema.parse(cleaned)).toEqual(cleaned);
    expect(removeSimulatorStudents(cleaned!)).toBeNull();
  });

  it('returns null and leaves all data intact when no exact original identity remains', () => {
    const value = workspace('manual-only', [manualStudent]);
    const data = dataFor([value]);
    const before = structuredClone(data);
    expect(removeSimulatorStudents(data)).toBeNull();
    expect(data).toEqual(before);
    expect(removeSimulatorStudents(data)).toBeNull();
  });
});
