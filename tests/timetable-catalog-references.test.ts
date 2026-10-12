import { describe, expect, it } from 'vitest';
import { mergeCatalogReferences } from '../src/features/timetable-import/catalog-references';
import { uniqueCatalogMatch } from '../src/features/timetable-import/card-text';
import type { CourseCatalogEntry } from '../src/features/timetable-import/model';

const entry = (changes: Partial<CourseCatalogEntry> = {}): CourseCatalogEntry => ({
  name: '虚构英语A3',
  code: 'X001',
  teacher: '测试老师',
  source: '目录乙.png',
  fieldConfidence: { name: 95, teacher: 92 },
  ...changes,
});

describe('overlapping multi-image catalog references', () => {
  it('merges overlapping rows and selects independently strongest name and teacher fields', () => {
    const items = [
      entry({ fieldConfidence: { name: 96, teacher: 60 }, teacher: '识别不可靠' }),
      entry({ fieldConfidence: { name: 91, teacher: 99 }, source: '目录甲.png' }),
      entry({ teacher: '', fieldConfidence: { name: 99 } }),
    ];
    const original = structuredClone(items);
    const merged = mergeCatalogReferences(items);
    expect(merged).toEqual([
      entry({ source: '目录乙.png', fieldConfidence: { name: 99, teacher: 99 } }),
    ]);
    expect(uniqueCatalogMatch('虚构英语A3', merged)?.teacher).toBe('测试老师');
    expect(items).toEqual(original);
  });

  it('normalizes wrapped titles and full-width digits while preserving the best title casing', () => {
    expect(
      mergeCatalogReferences([
        entry({ name: '虚构\n英语 a３', fieldConfidence: { name: 90, teacher: 92 } }),
        entry({ name: '虚构英语A3', code: 'X ００１' }),
      ]),
    ).toEqual([entry()]);
  });

  it('is independent of picture selection order, including equal-score alternatives', () => {
    const items = [
      entry({ name: '虚构英语a3', source: '目录甲.png' }),
      entry({ name: '虚构英语A3', source: '目录乙.png' }),
      entry({ name: '虚构数学', code: 'X002', source: '目录丙.png' }),
      entry({ teacher: '', fieldConfidence: { name: 97 } }),
    ];
    expect(mergeCatalogReferences(items)).toEqual(mergeCatalogReferences([...items].reverse()));
    expect(mergeCatalogReferences(items)).toEqual(
      mergeCatalogReferences([items[2], items[0], items[3], items[1]]),
    );
  });

  it('supplements a missing code only when the title has one code and a compatible teacher', () => {
    const merged = mergeCatalogReferences([
      entry({ code: '', teacher: '', fieldConfidence: { name: 99 } }),
      entry({ source: '目录甲.png' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ code: 'X001', teacher: '测试老师' });
    expect(merged[0].fieldConfidence).toEqual({ name: 99, teacher: 92 });
    expect(uniqueCatalogMatch('虚构英语A3', merged)).toBeDefined();
  });

  it('keeps genuinely different course codes ambiguous even when their teachers are equal', () => {
    const merged = mergeCatalogReferences([entry(), entry({ code: 'X002' }), entry({ code: '' })]);
    expect(merged.map((item) => item.code)).toEqual(['', 'X001', 'X002']);
    expect(uniqueCatalogMatch('虚构英语A3', merged)).toBeUndefined();
  });

  it('keeps reliable different teachers for the same course code ambiguous', () => {
    const merged = mergeCatalogReferences([
      entry(),
      entry({ teacher: '另一测试老师', fieldConfidence: { name: 94, teacher: 75 } }),
      entry({ teacher: '', fieldConfidence: { name: 99 } }),
      entry({ teacher: '另一测试老师', fieldConfidence: { name: 96, teacher: 96 } }),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.map((item) => item.teacher)).toEqual(['', '另一测试老师', '测试老师']);
    expect(merged.find((item) => item.teacher === '另一测试老师')?.fieldConfidence.teacher).toBe(
      96,
    );
    expect(uniqueCatalogMatch('虚构英语A3', merged)).toBeUndefined();
  });

  it('does not attach an uncoded teacher conflict to the known course code', () => {
    const merged = mergeCatalogReferences([entry(), entry({ code: '', teacher: '另一测试老师' })]);
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.code)).toEqual(['', 'X001']);
    expect(uniqueCatalogMatch('虚构英语A3', merged)).toBeUndefined();
  });

  it.each([74.99, 0, undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'clears unreliable teacher score %s before merging with a reliable row',
    (teacher) => {
      const merged = mergeCatalogReferences([
        entry({ teacher: '错误教师', fieldConfidence: { name: 97, teacher } }),
        entry({ fieldConfidence: { name: 95, teacher: 75 } }),
      ]);
      expect(merged).toHaveLength(1);
      expect(merged[0].teacher).toBe('测试老师');
      expect(merged[0].fieldConfidence).toEqual({ name: 97, teacher: 75 });
    },
  );

  it('leaves a teacher empty when every recognized teacher is unreliable', () => {
    const merged = mergeCatalogReferences([
      entry({ teacher: '错误教师', fieldConfidence: { name: 93, teacher: 74 } }),
      entry({ teacher: '另一错误教师', fieldConfidence: { name: 97, teacher: Number.NaN } }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ teacher: '', fieldConfidence: { name: 97 } });
    expect(merged[0].fieldConfidence.teacher).toBeUndefined();
  });

  it('does not use a nonfinite name score as the strongest reference', () => {
    const merged = mergeCatalogReferences([
      entry({ name: '虚构英语a3', fieldConfidence: { name: Number.NaN, teacher: 99 } }),
      entry({ fieldConfidence: { name: 93, teacher: 90 } }),
    ]);
    expect(merged[0]).toMatchObject({ name: '虚构英语A3', teacher: '测试老师' });
    expect(merged[0].fieldConfidence).toEqual({ name: 93, teacher: 99 });
  });

  it('merges duplicates with no codes but preserves different titles and returns an empty union', () => {
    const merged = mergeCatalogReferences([
      entry({ code: '' }),
      entry({ code: '', teacher: '', fieldConfidence: { name: 96 } }),
      entry({ name: '虚构数学', code: '' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(uniqueCatalogMatch('虚构英语A3', merged)?.teacher).toBe('测试老师');
    expect(mergeCatalogReferences([])).toEqual([]);
  });
});
