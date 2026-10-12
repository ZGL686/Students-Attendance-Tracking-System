import { describe, expect, it } from 'vitest';
import { canUseCardFastPath } from '../src/features/timetable-import/card-fast-path';
import type { CourseCatalogEntry, CourseDraft } from '../src/features/timetable-import/model';

const catalog: CourseCatalogEntry[] = [
  {
    code: 'TEST001',
    name: '测试英语A3',
    teacher: '测试老师',
    source: '虚构目录',
    fieldConfidence: { name: 90, teacher: 90 },
  },
];
const draft = (override: Partial<CourseDraft> = {}): CourseDraft => ({
  id: 'test-card',
  name: '测试英语A3',
  teacher: '',
  room: '测试楼-202',
  day: '2',
  start: '3',
  end: '4',
  weeks: '',
  color: 'blue',
  source: '虚构图片',
  issues: [],
  rawText: '测试英\n语A3\n@测试楼-202',
  layout: 'grid',
  fieldConfidence: { name: 80, room: 90, day: 100, periods: 100 },
  ...override,
});

describe('course card conservative fast path', () => {
  it('accepts matching complete names with Latin suffixes and reliable raw fields', () => {
    expect(canUseCardFastPath(draft(), draft({ name: '测试英\n语 A3' }), catalog)).toBe(true);
    expect(
      canUseCardFastPath(draft(), draft({ rawText: '测试英语A3\n＠测试楼-202' }), catalog),
    ).toBe(true);
  });

  it('accepts threshold scores and equivalent explicit week lists', () => {
    const a = draft({
      weeks: '1-8(单)',
      fieldConfidence: { name: 75, room: 85, day: 75, periods: 75 },
    });
    expect(canUseCardFastPath(a, draft({ weeks: '1,3,5,7' }), catalog)).toBe(true);
  });

  it('rejects missing title lines or mismatching alphanumeric suffixes', () => {
    expect(canUseCardFastPath(draft(), draft({ name: '英语A3' }), catalog)).toBe(false);
    expect(canUseCardFastPath(draft(), draft({ name: '测试英语A' }), catalog)).toBe(false);
    expect(canUseCardFastPath(draft({ name: '英语A3' }), draft({ name: '英语A3' }), catalog)).toBe(
      false,
    );
  });

  it('rejects missing, ambiguous, or unreliable catalog matches', () => {
    expect(canUseCardFastPath(draft(), draft(), [])).toBe(false);
    expect(
      canUseCardFastPath(draft(), draft(), [...catalog, { ...catalog[0], code: 'TEST002' }]),
    ).toBe(false);
    for (const confidence of [undefined, NaN, Infinity, 74.99, 101])
      expect(
        canUseCardFastPath(draft(), draft(), [
          { ...catalog[0], fieldConfidence: { name: confidence } },
        ]),
      ).toBe(false);
  });

  it('rejects missing, low, or nonfinite required field confidence', () => {
    for (const [field, minimum] of [
      ['name', 75],
      ['room', 85],
      ['day', 75],
      ['periods', 75],
    ] as const) {
      for (const value of [undefined, NaN, Infinity, minimum - 0.01, 101]) {
        const candidate = draft({
          fieldConfidence: { ...draft().fieldConfidence, [field]: value },
        });
        expect(canUseCardFastPath(candidate, draft(), catalog)).toBe(false);
        expect(canUseCardFastPath(draft(), candidate, catalog)).toBe(false);
      }
    }
    expect(canUseCardFastPath(draft({ fieldConfidence: undefined }), draft(), catalog)).toBe(false);
  });

  it('requires an explicit location anchor and literally agreeing nonempty rooms', () => {
    for (const candidate of [
      draft({ rawText: '测试英语A3\n测试楼-202' }),
      draft({ rawText: undefined }),
      draft({ room: '' }),
      draft({ room: '  ' }),
      draft({ room: '测试楼-203' }),
      draft({ room: '测试楼202' }),
    ]) {
      expect(canUseCardFastPath(candidate, draft(), catalog)).toBe(false);
      expect(canUseCardFastPath(draft(), candidate, catalog)).toBe(false);
    }
  });

  it('rejects unknown, invalid, incomplete, or different course placement', () => {
    for (const placement of [
      { day: '' },
      { day: '8' },
      { day: 'NaN' },
      { day: '3' },
      { start: '' },
      { start: '0' },
      { start: 'NaN' },
      { start: '3.0' },
      { start: '5', end: '4' },
      { start: '3', end: '11' },
      { start: '5', end: '8' },
    ])
      expect(canUseCardFastPath(draft(placement), draft(), catalog)).toBe(false);
    expect(canUseCardFastPath(draft({ blockingIssues: ['无法确定节次'] }), draft(), catalog)).toBe(
      false,
    );
  });

  it('rejects different week rules, parity, or invalid explicit weeks', () => {
    for (const weeks of ['1-16', '错误周次', '0-4', '31', '4-2'])
      expect(canUseCardFastPath(draft({ weeks }), draft(), catalog)).toBe(false);
    expect(
      canUseCardFastPath(draft({ weeks: '1-16(单)' }), draft({ weeks: '1-16(双)' }), catalog),
    ).toBe(false);
    expect(
      canUseCardFastPath(draft({ weeks: '错误周次' }), draft({ weeks: '错误周次' }), catalog),
    ).toBe(false);
  });
});
