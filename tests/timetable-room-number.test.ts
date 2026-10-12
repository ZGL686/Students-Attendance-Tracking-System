import { describe, expect, it, vi } from 'vitest';
import { verifyRoomNumber } from '../src/features/timetable-import/room-number';
import type { OcrEngine } from '../src/features/timetable-import/ocr-regions';
import type { OcrText } from '../src/features/timetable-import/ocr';
import type { ImageRect } from '../src/features/timetable-import/image-layout';
const recognized = (x: number, width: number, confidence = 90): OcrText => ({
  text: '-202',
  confidence,
  tokens: [{ text: '-202', x, y: 80, width, height: 20, confidence }],
});
const region = { x: 100, y: 0, width: 150, height: 130 };
const band = { top: 80, bottom: 100 };
const canvas = {} as HTMLCanvasElement;
describe('room number regional verification', () => {
  it('tries the original word box when a high-score retry box clips the digits', async () => {
    const scan = vi.fn(async (_image: HTMLCanvasElement, rect?: ImageRect) => ({
      text: rect && rect.width > 60 ? '-202' : '20',
      confidence: 91,
      tokens: [],
    }));
    const engine: OcrEngine = { scan, close: async () => {}, recognize: async () => [] };
    const value = await verifyRoomNumber(
      engine,
      canvas,
      region,
      band,
      [recognized(120, 12, 99)],
      recognized(130, 50),
      3,
    );
    expect(value).toBe('202');
    expect(scan).toHaveBeenCalledTimes(5);
  });
  it('leaves a conflicting or low-score room number unresolved', async () => {
    const scan = vi.fn(async () => ({ text: '-202', confidence: 74, tokens: [] }));
    const engine: OcrEngine = { scan, close: async () => {}, recognize: async () => [] };
    expect(
      await verifyRoomNumber(
        engine,
        canvas,
        region,
        band,
        [recognized(130, 50)],
        recognized(130, 50),
        3,
      ),
    ).toBeUndefined();
  });
  it('propagates cancellation instead of trying another region', async () => {
    const engine: OcrEngine = {
      scan: async () => {
        throw new DOMException('取消', 'AbortError');
      },
      close: async () => {},
      recognize: async () => [],
    };
    await expect(
      verifyRoomNumber(engine, canvas, region, band, [recognized(130, 50)], recognized(130, 50), 3),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
