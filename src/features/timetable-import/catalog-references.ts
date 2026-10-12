import { compactCourseText } from './card-text';
import type { CourseCatalogEntry } from './model';

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const finiteScore = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function reliableTeacher(entry: CourseCatalogEntry): string {
  return (finiteScore(entry.fieldConfidence.teacher) ?? 0) >= 75
    ? compactCourseText(entry.teacher)
    : '';
}

function combine(entries: CourseCatalogEntry[], code: string): CourseCatalogEntry {
  const names = [...entries].sort(
    (left, right) =>
      (finiteScore(right.fieldConfidence.name) ?? -1) -
        (finiteScore(left.fieldConfidence.name) ?? -1) ||
      compare(compactCourseText(left.name), compactCourseText(right.name)) ||
      compare(left.source, right.source),
  );
  const teachers = entries
    .filter((entry) => reliableTeacher(entry))
    .sort(
      (left, right) =>
        (finiteScore(right.fieldConfidence.teacher) ?? -1) -
          (finiteScore(left.fieldConfidence.teacher) ?? -1) || compare(left.source, right.source),
    );
  const name = names[0];
  const teacher = teachers[0];
  return {
    name: compactCourseText(name.name),
    code,
    teacher: teacher ? reliableTeacher(teacher) : '',
    source: entries.map((entry) => entry.source).sort(compare)[0],
    fieldConfidence: {
      name: finiteScore(name.fieldConfidence.name),
      teacher: teacher ? finiteScore(teacher.fieldConfidence.teacher) : undefined,
    },
  };
}

/** Merge overlapping catalog rows while retaining genuinely ambiguous references. */
export function mergeCatalogReferences(entries: CourseCatalogEntry[]): CourseCatalogEntry[] {
  const names = new Map<string, CourseCatalogEntry[]>();
  for (const entry of entries) {
    const key = compactCourseText(entry.name).toLowerCase();
    const group = names.get(key) ?? [];
    group.push(entry);
    names.set(key, group);
  }
  const result: CourseCatalogEntry[] = [];
  for (const group of names.values()) {
    const knownCodes = new Set(group.map((entry) => compactCourseText(entry.code)).filter(Boolean));
    const teachers = new Set(group.map(reliableTeacher).filter(Boolean));
    const supplementalCode = knownCodes.size === 1 && teachers.size <= 1 ? [...knownCodes][0] : '';
    const codes = new Map<string, CourseCatalogEntry[]>();
    for (const entry of group) {
      const code = compactCourseText(entry.code) || supplementalCode;
      const coded = codes.get(code) ?? [];
      coded.push(entry);
      codes.set(code, coded);
    }
    for (const [code, coded] of codes) {
      const reliableTeachers = new Set(coded.map(reliableTeacher).filter(Boolean));
      if (reliableTeachers.size <= 1) {
        result.push(combine(coded, code));
        continue;
      }
      // A blank teacher cannot choose between two reliable instructors.
      const alternatives = new Map<string, CourseCatalogEntry[]>();
      for (const entry of coded) {
        const teacher = reliableTeacher(entry);
        const teaching = alternatives.get(teacher) ?? [];
        teaching.push(entry);
        alternatives.set(teacher, teaching);
      }
      for (const teaching of alternatives.values()) result.push(combine(teaching, code));
    }
  }
  return result.sort(
    (left, right) =>
      compare(left.name.toLowerCase(), right.name.toLowerCase()) ||
      compare(left.code, right.code) ||
      compare(left.teacher, right.teacher) ||
      compare(left.name, right.name) ||
      compare(left.source, right.source),
  );
}
