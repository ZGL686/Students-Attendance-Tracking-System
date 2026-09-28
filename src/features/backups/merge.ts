import type { AppData, AttendanceRecord, Workspace } from '../../model';
import { dataSchema } from '../../model';

export type ConflictChoice = 'windows' | 'phone';
export type RecordConflict = {
  key: string;
  workspaceId: string;
  workspaceName: string;
  studentName: string;
  phone: AttendanceRecord;
  windows: AttendanceRecord;
};
export type MergePreview = {
  data: AppData | null;
  addedWorkspaces: number;
  addedRecords: number;
  unchangedRecords: number;
  conflicts: RecordConflict[];
  issues: string[];
};
export type ConflictChoices = Readonly<Record<string, ConflictChoice>>;

const conflictKey = (workspaceId: string, recordId: string) => `${workspaceId}\u0000${recordId}`;
const sameRecord = (left: AttendanceRecord, right: AttendanceRecord) =>
  JSON.stringify(left) === JSON.stringify(right);

function recordStudentName(workspace: Workspace, record: AttendanceRecord) {
  return workspace.students.find((student) => student.id === record.studentId)?.name ?? '未知学生';
}

export function isPristineMobileData(data: AppData) {
  return (
    data.workspaces.length === 1 &&
    data.workspaces.every(
      (workspace) =>
        !workspace.deletedAt &&
        workspace.students.length === 0 &&
        workspace.courses.length === 0 &&
        workspace.records.length === 0 &&
        !workspace.notes,
    )
  );
}

export function initializePhoneFromWindows(incoming: AppData): MergePreview {
  const data = dataSchema.parse(structuredClone(incoming));
  return {
    data,
    addedWorkspaces: data.workspaces.length,
    addedRecords: data.workspaces.reduce((sum, workspace) => sum + workspace.records.length, 0),
    unchangedRecords: 0,
    conflicts: [],
    issues: [],
  };
}

/** Merge a phone backup into Windows without replacing Windows-owned data. */
export function mergePhoneIntoWindows(
  current: AppData,
  incoming: AppData,
  choices: ConflictChoices = {},
): MergePreview {
  const next = structuredClone(current);
  const conflicts: RecordConflict[] = [];
  const issues: string[] = [];
  let addedRecords = 0;
  let unchangedRecords = 0;

  for (const phoneWorkspace of incoming.workspaces) {
    const windowsWorkspace = next.workspaces.find(
      (workspace) => workspace.id === phoneWorkspace.id,
    );
    if (!windowsWorkspace) {
      issues.push(
        `找不到 Windows 工作台“${phoneWorkspace.name}”。请先从 Windows 导出包含该工作台的备份。`,
      );
      continue;
    }

    const windowsRecords = new Map(windowsWorkspace.records.map((record) => [record.id, record]));
    for (const phoneRecord of phoneWorkspace.records) {
      const windowsRecord = windowsRecords.get(phoneRecord.id);
      if (windowsRecord) {
        if (sameRecord(windowsRecord, phoneRecord)) {
          unchangedRecords++;
          continue;
        }
        const key = conflictKey(windowsWorkspace.id, phoneRecord.id);
        conflicts.push({
          key,
          workspaceId: windowsWorkspace.id,
          workspaceName: windowsWorkspace.name,
          studentName: recordStudentName(windowsWorkspace, windowsRecord),
          phone: structuredClone(phoneRecord),
          windows: structuredClone(windowsRecord),
        });
        if (choices[key] === 'phone') {
          const index = windowsWorkspace.records.findIndex(
            (record) => record.id === phoneRecord.id,
          );
          windowsWorkspace.records[index] = structuredClone(phoneRecord);
        }
        continue;
      }

      if (!windowsWorkspace.students.some((student) => student.id === phoneRecord.studentId)) {
        issues.push(
          `“${windowsWorkspace.name}”中的一条手机考勤找不到对应学生（${phoneRecord.studentId}），未能合并。`,
        );
        continue;
      }
      if (!windowsWorkspace.categories.some((category) => category.id === phoneRecord.category)) {
        issues.push(
          `“${windowsWorkspace.name}”中的一条手机考勤找不到对应考勤类型（${phoneRecord.category}），未能合并。`,
        );
        continue;
      }
      windowsWorkspace.records.push(structuredClone(phoneRecord));
      windowsRecords.set(phoneRecord.id, phoneRecord);
      addedRecords++;
    }
  }

  let parsed: AppData | null = null;
  if (!issues.length) {
    try {
      parsed = dataSchema.parse(next);
    } catch (error) {
      issues.push(
        `合并结果未通过数据校验：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    data: parsed,
    addedWorkspaces: 0,
    addedRecords,
    unchangedRecords,
    conflicts,
    issues,
  };
}

/** Refresh Windows-owned roster/course settings on Android while retaining local attendance. */
export function syncWindowsToPhone(
  current: AppData,
  incoming: AppData,
  choices: ConflictChoices = {},
): MergePreview {
  const next = structuredClone(current);
  const conflicts: RecordConflict[] = [];
  const issues: string[] = [];
  let addedWorkspaces = 0;
  let addedRecords = 0;
  let unchangedRecords = 0;

  for (const windowsWorkspace of incoming.workspaces) {
    const phoneIndex = next.workspaces.findIndex(
      (workspace) => workspace.id === windowsWorkspace.id,
    );
    if (phoneIndex < 0) {
      next.workspaces.push(structuredClone(windowsWorkspace));
      addedWorkspaces++;
      continue;
    }

    const phoneWorkspace = next.workspaces[phoneIndex];
    const phoneRecords = new Map(phoneWorkspace.records.map((record) => [record.id, record]));
    const mergedRecords = phoneWorkspace.records.map((record) => structuredClone(record));
    const mergedIndices = new Map(mergedRecords.map((record, index) => [record.id, index]));

    for (const windowsRecord of windowsWorkspace.records) {
      const phoneRecord = phoneRecords.get(windowsRecord.id);
      if (!phoneRecord) {
        mergedIndices.set(windowsRecord.id, mergedRecords.length);
        mergedRecords.push(structuredClone(windowsRecord));
        addedRecords++;
        continue;
      }
      if (sameRecord(phoneRecord, windowsRecord)) {
        unchangedRecords++;
        continue;
      }
      const key = conflictKey(windowsWorkspace.id, windowsRecord.id);
      conflicts.push({
        key,
        workspaceId: windowsWorkspace.id,
        workspaceName: windowsWorkspace.name,
        studentName: recordStudentName(windowsWorkspace, windowsRecord),
        phone: structuredClone(phoneRecord),
        windows: structuredClone(windowsRecord),
      });
      if (choices[key] !== 'phone')
        mergedRecords[mergedIndices.get(windowsRecord.id)!] = structuredClone(windowsRecord);
    }

    const mergedStudents = [...structuredClone(windowsWorkspace.students)];
    const studentIds = new Set(mergedStudents.map((student) => student.id));
    const mergedCategories = [...structuredClone(windowsWorkspace.categories)];
    const categoryIds = new Set(mergedCategories.map((category) => category.id));
    for (const record of mergedRecords) {
      if (!studentIds.has(record.studentId)) {
        const historicalStudent = phoneWorkspace.students.find(
          (student) => student.id === record.studentId,
        );
        if (!historicalStudent) {
          issues.push(
            `“${windowsWorkspace.name}”中的一条本机考勤找不到对应学生，无法保留历史记录。`,
          );
          continue;
        }
        if (mergedStudents.some((student) => student.number === historicalStudent.number)) {
          issues.push(
            `“${windowsWorkspace.name}”中的历史学生“${historicalStudent.name}”与 Windows 名单学号重复，请先在 Windows 处理名单。`,
          );
          continue;
        }
        mergedStudents.push(structuredClone(historicalStudent));
        studentIds.add(historicalStudent.id);
      }
      if (!categoryIds.has(record.category)) {
        const historicalCategory = phoneWorkspace.categories.find(
          (category) => category.id === record.category,
        );
        if (!historicalCategory) {
          issues.push(
            `“${windowsWorkspace.name}”中的一条本机考勤找不到对应类型，无法保留历史记录。`,
          );
          continue;
        }
        mergedCategories.push(structuredClone(historicalCategory));
        categoryIds.add(historicalCategory.id);
      }
    }
    if (mergedCategories.length > 12)
      issues.push(
        `“${windowsWorkspace.name}”保留本机历史类型后超过 12 种，请先在 Windows 整理考勤类型。`,
      );

    next.workspaces[phoneIndex] = {
      ...structuredClone(windowsWorkspace),
      students: mergedStudents,
      categories: mergedCategories,
      records: mergedRecords,
    };
  }

  next.activeWorkspaceId = incoming.activeWorkspaceId;
  let parsed: AppData | null = null;
  if (!issues.length) {
    try {
      parsed = dataSchema.parse(next);
    } catch (error) {
      issues.push(
        `同步结果未通过数据校验：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { data: parsed, addedWorkspaces, addedRecords, unchangedRecords, conflicts, issues };
}

export function recordConflictKey(workspaceId: string, recordId: string) {
  return conflictKey(workspaceId, recordId);
}
