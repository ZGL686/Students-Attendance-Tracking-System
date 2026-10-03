import type { AppData, Workspace } from '../../model';
import type { CourseDraft, ImportMode } from './model';
import { validateDrafts } from './model';

export function importFingerprint(workspace: Workspace) {
  return JSON.stringify([workspace.totalWeeks, workspace.courses]);
}

export function commitAutomaticCourseImport(
  data: AppData,
  targetId: string,
  drafts: CourseDraft[],
) {
  const target = data.workspaces.find((workspace) => workspace.id === targetId);
  if (!target || target.deletedAt || data.activeWorkspaceId !== targetId)
    throw new Error('目标工作台已切换或删除，请返回目标工作台重新导入。');
  const result = validateDrafts(drafts, target.courses, 'append', target.totalWeeks);
  if (!result.courses.length && !result.duplicates)
    throw new Error('未识别到可保存的完整课程，请上传包含课程名、星期、节次和周次的清晰课表。');
  target.courses.push(...result.courses);
  return {
    imported: result.courses.length,
    duplicates: result.duplicates,
    skipped: result.issues.map((issue) => {
      const draft = drafts.find((item) => item.id === issue.draftId);
      return `${draft?.name || '未识别课程'}（${draft?.source || '课表'}）：${issue.message.replace('请调整或取消选中。', '本次已跳过。')}`;
    }),
  };
}

// Called inside AppProvider.change so validation and assignment use the same snapshot.
export function commitCourseImport(
  data: AppData,
  targetId: string,
  drafts: CourseDraft[],
  mode: ImportMode,
  confirmedFingerprint: string,
) {
  const target = data.workspaces.find((workspace) => workspace.id === targetId);
  if (!target || target.deletedAt) throw new Error('原工作台已被删除，请取消后重新导入。');
  if (data.activeWorkspaceId !== targetId)
    throw new Error('当前工作台已切换，请返回原工作台后重新导入。');
  if (importFingerprint(target) !== confirmedFingerprint)
    throw new Error('课表或学期设置已变化，请返回检查页重新确认。');
  if (!drafts.length) throw new Error('请至少选择一门课程。');
  const result = validateDrafts(drafts, target.courses, mode, target.totalWeeks);
  if (result.issues.length) throw new Error(result.issues[0].message);
  if (!result.courses.length) throw new Error('所选课程已存在，没有需要导入的新课程。');
  target.courses = mode === 'replace' ? result.courses : [...target.courses, ...result.courses];
  return { imported: result.courses.length, duplicates: result.duplicates };
}
