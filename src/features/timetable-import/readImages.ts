import { detectCatalogRows } from './catalog-layout';
import { compactCourseText } from './card-text';
import { detectColoredRegions, locateGridAxes, regionPlacement } from './image-layout';
import type { ImageRect } from './image-layout';
import { checkAborted } from './model';
import type { CourseCatalogEntry, CourseDraft, ImportResult, ReadOptions } from './model';
import { createOcr, imageCanvas } from './ocr';
import type { OcrText } from './ocr';
import { retryRegion } from './ocr-regions';
import { parsePositionedText, parseTextBlocks } from './parse';
import { readCard } from './readCard';

type Engine = Awaited<ReturnType<typeof createOcr>>;
function inset(rect: ImageRect): ImageRect {
  const padding = Math.max(2, Math.min(rect.width, rect.height) * 0.035);
  return {
    x: Math.ceil(rect.x + padding),
    y: Math.ceil(rect.y + padding),
    width: Math.max(1, Math.floor(rect.width - 2 * padding)),
    height: Math.max(1, Math.floor(rect.height - 2 * padding)),
  };
}

export async function readImages(files: File[], options: ReadOptions): Promise<ImportResult> {
  let engine: Engine | undefined;
  const prepared: {
    file: File;
    canvas: HTMLCanvasElement;
    scan: OcrText;
    rows: ReturnType<typeof detectCatalogRows>;
    regions: ImageRect[];
  }[] = [];
  const catalog: CourseCatalogEntry[] = [...(options.catalog ?? [])];
  const drafts: CourseDraft[] = [];
  const warnings: string[] = [];
  try {
    engine = await createOcr(options);
    for (const file of files) {
      checkAborted(options.signal);
      const canvas = await imageCanvas(file, options.signal);
      // Register ownership before an abortable recognition can fail.
      const item = {
        file,
        canvas,
        scan: { text: '', tokens: [], confidence: 0 } as OcrText,
        rows: [] as ReturnType<typeof detectCatalogRows>,
        regions: [] as ImageRect[],
      };
      prepared.push(item);
      options.onProgress?.({ stage: `正在分析 ${file.name} 的版式…`, progress: 0 });
      item.scan = await engine.scan(canvas);
      const pixels = canvas
        .getContext('2d', { willReadFrequently: true })!
        .getImageData(0, 0, canvas.width, canvas.height);
      item.rows = detectCatalogRows(pixels, item.scan.tokens);
      item.regions = item.rows.length ? [] : detectColoredRegions(pixels);
    }
    // The reference table is always processed first, even if selected second.
    for (const item of prepared.filter((value) => value.rows.length)) {
      for (const [index, row] of item.rows.entries()) {
        checkAborted(options.signal);
        options.onProgress?.({
          stage: `正在识别课程目录 ${index + 1}/${item.rows.length}…`,
          progress: index / item.rows.length,
        });
        const name = (await retryRegion(engine, item.canvas, row.name, true)).sort(
          (a, b) => b.confidence - a.confidence,
        )[0];
        const teacher = row.teacher
          ? (await retryRegion(engine, item.canvas, row.teacher, true)).sort(
              (a, b) => b.confidence - a.confidence,
            )[0]
          : undefined;
        const code = row.code
          ? (await retryRegion(engine, item.canvas, row.code, true)).sort(
              (a, b) => b.confidence - a.confidence,
            )[0]
          : undefined;
        const entry: CourseCatalogEntry = {
          name: compactCourseText(name.text),
          teacher: teacher && teacher.confidence >= 75 ? compactCourseText(teacher.text) : '',
          code: row.code
            ? compactCourseText(
                item.scan.tokens
                  .filter(
                    (token) =>
                      token.x + token.width / 2 >= row.code!.x &&
                      token.x + token.width / 2 <= row.code!.x + row.code!.width &&
                      token.y + token.height / 2 >= row.code!.y &&
                      token.y + token.height / 2 <= row.code!.y + row.code!.height,
                  )
                  .sort((a, b) => a.x - b.x)
                  .map((token) => token.text)
                  .join(''),
              ) || compactCourseText(code?.text ?? '')
            : '',
          source: item.file.name,
          fieldConfidence: { name: name.confidence, teacher: teacher?.confidence },
        };
        if (entry.name) catalog.push(entry);
        if (teacher && teacher.confidence < 75)
          warnings.push(`${entry.name || `目录第${index + 1}行`}：教师识别分数低于 75，已留空。`);
      }
    }
    const references = catalog.filter(
      (entry, index) =>
        catalog.findIndex(
          (other) =>
            other.name === entry.name &&
            other.teacher === entry.teacher &&
            other.code === entry.code,
        ) === index,
    );
    for (const item of prepared.filter((value) => !value.rows.length)) {
      if (item.regions.length) {
        const sidebarWidth = Math.max(
          1,
          Math.floor(Math.min(...item.regions.map((region) => region.x)) * 0.95),
        );
        const sidebar = await engine.scan(
          item.canvas,
          { x: 0, y: 0, width: sidebarWidth, height: item.canvas.height },
          1,
          'sparse',
        );
        const headerHeight = Math.max(
          1,
          Math.floor(Math.min(...item.regions.map((region) => region.y))),
        );
        const header = await engine.scan(
          item.canvas,
          { x: 0, y: 0, width: item.canvas.width, height: headerHeight },
          1,
          'sparse',
        );
        const axisTokens = [...item.scan.tokens, ...sidebar.tokens, ...header.tokens];
        let axes = locateGridAxes(axisTokens, item.regions, item.canvas.width, item.canvas.height);
        for (const scale of [2, 3]) {
          if (axes) break;
          axisTokens.push(
            ...(
              await engine.scan(
                item.canvas,
                { x: 0, y: 0, width: sidebarWidth, height: item.canvas.height },
                scale,
                'sparse',
              )
            ).tokens,
          );
          axisTokens.push(
            ...(
              await engine.scan(
                item.canvas,
                { x: 0, y: 0, width: item.canvas.width, height: headerHeight },
                scale,
                'sparse',
              )
            ).tokens,
          );
          axes = locateGridAxes(axisTokens, item.regions, item.canvas.width, item.canvas.height);
        }
        for (const [index, region] of item.regions.entries()) {
          checkAborted(options.signal);
          options.onProgress?.({
            stage: `正在识别课程格 ${index + 1}/${item.regions.length}…`,
            progress: index / item.regions.length,
          });
          drafts.push(
            await readCard(
              engine,
              item.canvas,
              inset(region),
              item.file.name,
              axes ? regionPlacement(region, axes) : null,
              references,
            ),
          );
        }
      } else {
        const parsed = item.scan.tokens.length
          ? parsePositionedText(item.scan.tokens, item.file.name)
          : parseTextBlocks(item.scan.text, item.file.name);
        drafts.push(...parsed);
      }
    }
    return {
      drafts,
      catalog: references,
      sources: files.map((file, index) => ({ index, label: file.name })),
      warnings: [...new Set(warnings)],
    };
  } finally {
    try {
      await engine?.close();
    } finally {
      for (const { canvas } of prepared) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }
}
