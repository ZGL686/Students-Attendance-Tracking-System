import { describe, expect, it } from 'vitest';
import {
  cardDraft,
  compactRoomText,
  compactCourseText,
  uniqueCatalogMatch,
} from '../src/features/timetable-import/card-text';
import type { OcrText } from '../src/features/timetable-import/ocr';
import { parseImportWeeks, validateDrafts } from '../src/features/timetable-import/model';

const recognized = (lines: string[], confidence = 92): OcrText => ({
  text: lines.join('\n'),
  confidence,
  tokens: lines.map((text, index) => ({
    text,
    x: 20,
    y: index * 40,
    width: 110,
    height: 30,
    confidence,
  })),
});
const reference = {
  code: 'X001',
  name: '数字英语A3',
  teacher: '虚构教师',
  source: '虚构目录',
  fieldConfidence: { name: 95, teacher: 91 },
};
describe('course card field parsing', () => {
  it('joins wrapped Chinese and retains A3 and the @ classroom', () => {
    const result = cardDraft(
      recognized(['数字英', '语 A3', '@虚构校区', '2号楼-208']),
      '虚构课表',
      { day: 2, start: 3, end: 4 },
      [reference],
    );
    expect(result).toMatchObject({
      name: '数字英语A3',
      teacher: '虚构教师',
      room: '虚构校区2号楼-208',
      day: '2',
      start: '3',
      end: '4',
      weeks: '',
    });
  });
  it('does not invent a placement and clears a doubtful room', () => {
    const result = cardDraft(recognized(['图形设', '计', '@虚构教室'], 60), '虚构课表', null, []);
    expect(result.blockingIssues).toHaveLength(1);
    expect(result.room).toBe('');
    expect(result.issues.join()).toContain('75');
  });
  it('requires a unique catalog match and preserves ASCII numbers', () => {
    expect(uniqueCatalogMatch('数字英语A3', [reference, reference])).toBeUndefined();
    expect(uniqueCatalogMatch('数字英语A', [reference])).toBeUndefined();
    expect(compactCourseText('数字\n英语 A３')).toBe('数字英语A3');
  });
  it.each([
    ['第3周', [3]],
    ['周次：3', [3]],
    ['1,3,5周', [1, 3, 5]],
    ['第１、３、５周', [1, 3, 5]],
    ['1-3,5周', [1, 2, 3, 5]],
    ['1-8周(单)', [1, 3, 5, 7]],
    ['周次：1-8,10-16(单)', [1, 3, 5, 7, 11, 13, 15]],
    ['Weeks: 2-4', [2, 3, 4]],
  ])(
    'preserves explicit card week rule %s instead of inferring the entire semester',
    (text, weeks) => {
      const result = cardDraft(
        recognized(['虚构课程', '@虚构楼-101', text as string]),
        '虚构课程格',
        { day: 3, start: 1, end: 2 },
        [],
      );
      expect(parseImportWeeks(result.weeks)).toEqual(weeks);
      expect(result.room).toBe('虚构楼-101');
      expect(validateDrafts([result], [], 'append', 20).issues).toEqual([]);
    },
  );
  it('retains invalid explicit weeks and blocks ambiguous multiple rules', () => {
    const invalid = cardDraft(
      recognized(['虚构课程', '@虚构楼', '第31周']),
      '虚构课程格',
      { day: 1, start: 1, end: 2 },
      [],
    );
    expect(invalid.weeks).not.toBe('');
    expect(validateDrafts([invalid], [], 'append', 20).courses).toEqual([]);
    const ambiguous = cardDraft(
      recognized(['虚构课程', '@虚构楼', '1-2周', '5-6周']),
      '虚构课程格',
      { day: 1, start: 1, end: 2 },
      [],
    );
    expect(ambiguous.blockingIssues?.join()).toContain('多组周次');
    expect(validateDrafts([{ ...ambiguous, weeks: '1-20' }], [], 'append', 20).courses).toEqual([]);
  });
  it('does not concatenate trailing teacher, period or week metadata into a wrapped room', () => {
    const result = cardDraft(
      recognized(['虚构课程', '@虚构校区', '2号楼-208', '教师：虚构教师', '第3周']),
      '虚构课程格',
      { day: 2, start: 3, end: 4 },
      [],
    );
    expect(result).toMatchObject({ name: '虚构课程', room: '虚构校区2号楼-208', weeks: '3' });
    expect(compactRoomText('@虚构楼-101 周次：1-16')).toBe('虚构楼-101');
    expect(compactRoomText('@虚构楼-101\n第1-2节\n周次：1-16')).toBe('虚构楼-101');
    expect(compactRoomText('教室：虚构楼-101\n教师：虚构教师')).toBe('虚构楼-101');
    expect(
      cardDraft(
        recognized(['虚构课程', '教室：虚构楼-101', '第3周']),
        '虚构课程格',
        { day: 2, start: 3, end: 4 },
        [],
      ).name,
    ).toBe('虚构课程');
  });
  it('keeps metadata before the @ marker out of a title while preserving catalog-prefix matching', () => {
    const result = cardDraft(
      recognized(['数字英', '语 A3', '教师：虚构教师', '@虚构校区', '第3周']),
      '虚构课程格',
      { day: 2, start: 3, end: 4 },
      [reference],
    );
    expect(result).toMatchObject({
      name: '数字英语A3',
      teacher: '虚构教师',
      room: '虚构校区',
      weeks: '3',
    });
    const noAt = cardDraft(
      recognized(['数字英', '语 A3', '虚构校区2号楼-208']),
      '虚构课程格',
      { day: 2, start: 3, end: 4 },
      [reference],
    );
    expect(noAt.name).toBe('数字英语A3');
  });
  it('preserves a real zero name score despite a high overall score and skips it', () => {
    const scan = recognized(['虚构课程', '@虚构楼-101'], 99);
    scan.tokens[0].confidence = 0;
    const result = cardDraft(scan, '虚构课程格', { day: 1, start: 1, end: 2 }, []);
    expect(result.fieldConfidence?.name).toBe(0);
    expect(validateDrafts([{ ...result, weeks: '1-20' }], [], 'append', 20).courses).toEqual([]);
  });
  it('preserves a real zero room score instead of averaging in later high-confidence weeks', () => {
    const scan = recognized(['虚构课程', '@虚构楼-101', '第3周'], 99);
    scan.tokens[1].confidence = 0;
    const result = cardDraft(scan, '虚构课程格', { day: 1, start: 1, end: 2 }, []);
    expect(result.fieldConfidence?.room).toBe(0);
    expect(result.room).toBe('');
    expect(result.issues.join()).toContain('75');
    expect(result.weeks).toBe('3');
  });
  it('allows an independent exact unique catalog name to support a doubtful card name', () => {
    const scan = recognized(['数字英语A3', '@虚构楼-101'], 99);
    scan.tokens[0].confidence = 0;
    const result = cardDraft(scan, '虚构课程格', { day: 1, start: 1, end: 2 }, [reference]);
    expect(result.fieldConfidence?.name).toBe(95);
    expect(validateDrafts([{ ...result, weeks: '1-20' }], [], 'append', 20).courses).toHaveLength(
      1,
    );
  });
});
