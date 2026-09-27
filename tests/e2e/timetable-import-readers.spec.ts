import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Small, fully synthetic PDFs keep the integration fixtures independent of user files.
function buildPdf(objects: Buffer[]): Buffer {
  const chunks = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  });
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
    ),
  );
  return Buffer.concat(chunks);
}

function streamPdf(dictionary: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    Buffer.from('\nendstream'),
  ]);
}

function textPdf(): Buffer {
  const stream = Buffer.from(
    [
      'BT /F1 16 Tf 150 360 Td (Monday) Tj ET',
      'BT /F1 16 Tf 350 360 Td (Tuesday) Tj ET',
      'BT /F1 16 Tf 20 310 Td (1) Tj ET',
      'BT /F1 16 Tf 20 260 Td (2) Tj ET',
      'BT /F1 16 Tf 125 310 Td (Design Basics) Tj ET',
      'BT /F1 16 Tf 125 290 Td (Weeks: 1-16) Tj ET',
    ].join('\n'),
  );
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    streamPdf('', stream),
  ]);
}

function scannedPdf(jpeg: Buffer): Buffer {
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 450] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    ),
    streamPdf(
      '/Type /XObject /Subtype /Image /Width 800 /Height 450 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode',
      jpeg,
    ),
    streamPdf('', Buffer.from('q 800 0 0 450 0 0 cm /Im0 Do Q')),
  ]);
}

async function syntheticImage(page: Page, type: 'image/png' | 'image/jpeg'): Promise<Buffer> {
  const data = await page.evaluate((type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 800, 450);
    context.fillStyle = '#111';
    context.font = '36px "Microsoft YaHei", sans-serif';
    context.fillText('星期一', 150, 70);
    context.fillText('星期二', 480, 70);
    context.fillText('数字设计', 135, 170);
    context.fillText('1-16周', 135, 225);
    context.fillText('第1-2节', 135, 280);
    context.fillText('1', 20, 170);
    context.fillText('2', 20, 280);
    return canvas.toDataURL(type, 0.98).split(',')[1];
  }, type);
  return Buffer.from(data, 'base64');
}

async function readInBrowser(page: Page, name: string, bytes: Buffer) {
  return page.evaluate(
    async ({ name, base64 }) => {
      const path = '/src/features/timetable-import/read.ts';
      const { inspectImportFile, readImportFile } = await import(path);
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([data], name);
      const sources = await inspectImportFile(file);
      const result = await readImportFile(file, { selection: [0] });
      return { sources, drafts: result.drafts, warnings: result.warnings };
    },
    { name, base64: bytes.toString('base64') },
  );
}

test.describe('local course file readers', () => {
  test.setTimeout(120_000);
  const remote: string[] = [];
  test.beforeEach(async ({ page }) => {
    remote.length = 0;
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') await route.continue();
      else {
        remote.push(url.origin);
        await route.abort();
      }
    });
    await page.route('**/local-seed.json', (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto('/');
  });
  test.afterEach(() => {
    expect(remote).toEqual([]);
  });

  test('reads a text PDF using bundled worker and fonts', async ({ page }) => {
    const result = await readInBrowser(page, '虚构文字课表.pdf', textPdf());
    expect(result.sources).toEqual([{ index: 0, label: '第 1 页' }]);
    expect(result.drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Design Basics', day: '1', weeks: '1-16' }),
      ]),
    );
    expect(result.warnings.join()).not.toContain('离线图片识别');
  });

  test('recognizes a Chinese image with an empty browser cache and no remote requests', async ({
    page,
  }) => {
    const result = await readInBrowser(
      page,
      '虚构中文课表.png',
      await syntheticImage(page, 'image/png'),
    );
    expect(
      result.drafts.some(
        (draft: { name: string; day: string; weeks: string }) =>
          draft.name.replace(/\s/g, '').includes('数字设计') && draft.day === '1' && !!draft.weeks,
      ),
      JSON.stringify(result.drafts, null, 2),
    ).toBe(true);
  });

  test('renders a scanned PDF then recognizes it locally', async ({ page }) => {
    const result = await readInBrowser(
      page,
      '虚构扫描课表.pdf',
      scannedPdf(await syntheticImage(page, 'image/jpeg')),
    );
    expect(
      result.drafts.some(
        (draft: { name: string; day: string; weeks: string }) =>
          draft.name.replace(/\s/g, '').includes('数字设计') && draft.day === '1' && !!draft.weeks,
      ),
      JSON.stringify(result.drafts, null, 2),
    ).toBe(true);
    expect(result.warnings.join()).toContain('离线图片识别');
  });
});
