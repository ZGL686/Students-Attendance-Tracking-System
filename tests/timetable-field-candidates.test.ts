import { describe, expect, it } from 'vitest';
import { selectRoomCandidate } from '../src/features/timetable-import/field-candidates';
import type { FieldCandidate } from '../src/features/timetable-import/field-candidates';
const candidate = (
  text: string,
  family: FieldCandidate['family'],
  confidence = 90,
  anchored = true,
): FieldCandidate => ({ text, family, confidence, anchored });
describe('independent classroom evidence', () => {
  it('does not count three scales of one region as three independent votes', () => {
    const result = selectRoomCandidate([
      candidate('错字楼-101', 'color-card', 94),
      candidate('错字楼-101', 'color-card', 94),
      candidate('错字楼-101', 'color-card', 94),
      candidate('虚构楼-101', 'contrast-card', 81),
      candidate('虚构楼-101', 'contrast-room', 83),
    ]);
    expect(result?.text).toBe('虚构楼-101');
  });
  it('uses the stronger field score when independent evidence is tied', () => {
    const result = selectRoomCandidate([
      candidate('错字楼-101', 'color-card', 94),
      candidate('错字楼-101', 'color-room', 94),
      candidate('虚构楼-101', 'contrast-card', 81),
      candidate('虚构楼-101', 'contrast-room', 83),
    ]);
    expect(result?.text).toBe('错字楼-101');
  });
  it('ignores low scores and unanchored partial numbers', () => {
    expect(
      selectRoomCandidate([
        candidate('101', 'contrast-room', 99, false),
        candidate('虚构楼-101', 'color-card', 90),
        candidate('低分', 'contrast-card', 74),
      ])?.text,
    ).toBe('虚构楼-101');
    expect(selectRoomCandidate([candidate('低分', 'contrast-card', 74)])).toBeUndefined();
  });
});
