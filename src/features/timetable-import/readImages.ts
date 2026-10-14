import { detectCatalogRows } from './catalog-layout';
import { compactCourseText } from './card-text';
import { detectColoredRegions, locateGridAxes, regionPlacement } from './image-layout';
import type { GridAxes, ImageRect } from './image-layout';
import { cachedCatalogField } from './catalog-field';
import { mergeCatalogReferences } from './catalog-references';
import { createImportProgress } from './import-progress';
import { checkAborted } from './model';
import type { CourseCatalogEntry, CourseDraft, ImportResult, ReadOptions } from './model';
import { createOcr, imageCanvas } from './ocr';
import type { OcrText } from './ocr';
import { retryRegion } from './ocr-regions';
import { parsePositionedText, parseTextBlocks } from './parse';
import { readCard } from './readCard';
import { readGridAxes } from './read-grid-axes';

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
  const progress = createImportProgress(options.onProgress, options.signal);
  progress.phase('正在加载本地识别引擎…', 0, 0.02);
  let engine: Engine | undefined;
  const prepared: {
    file: File;
    scan: OcrText;
    rows: ReturnType<typeof detectCatalogRows>;
    regions: ImageRect[];
    axes: GridAxes | null;
  }[] = [];
  const canvases = new Set<HTMLCanvasElement>();
  const releaseCanvas = (canvas: HTMLCanvasElement) => {
    canvas.width = 0;
    canvas.height = 0;
    canvases.delete(canvas);
  };
  const catalog: CourseCatalogEntry[] = [...(options.catalog ?? [])];
  const drafts: CourseDraft[] = [];
  const warnings: string[] = [];
  let currentFile: File | undefined;
  let currentStage = '加载本地识别引擎';
  try {
    engine = await createOcr({ ...options, onProgress: progress.worker }, true);
    for (const [fileIndex, file] of files.entries()) {
      checkAborted(options.signal);
      currentFile = file;
      currentStage = '解码';
      const phaseStart = 0.02 + (0.13 * fileIndex) / files.length;
      const phaseEnd = 0.02 + (0.13 * (fileIndex + 1)) / files.length;
      const decodeEnd = phaseStart + (phaseEnd - phaseStart) * 0.1;
      progress.phase(
        `正在解码图片 ${fileIndex + 1}/${files.length}（${file.name}）…`,
        phaseStart,
        decodeEnd,
      );
      const canvas = await imageCanvas(file, options.signal);
      canvases.add(canvas);
      progress.finish();
      // Register ownership before an abortable recognition can fail.
      const item = {
        file,
        scan: { text: '', tokens: [], confidence: 0 } as OcrText,
        rows: [] as ReturnType<typeof detectCatalogRows>,
        regions: [] as ImageRect[],
        axes: null as GridAxes | null,
      };
      prepared.push(item);
      currentStage = '分析图片版式';
      progress.phase(
        `正在分析图片 ${fileIndex + 1}/${files.length} 的版式（${file.name}）…`,
        decodeEnd,
        phaseEnd,
        10,
      );
      const pixels = canvas
        .getContext('2d', { willReadFrequently: true })!
        .getImageData(0, 0, canvas.width, canvas.height);
      item.regions = detectColoredRegions(pixels);
      if (item.regions.length >= 2) {
        currentStage = '识别星期与节次';
        const grid = await readGridAxes(engine, canvas, item.regions);
        item.axes = grid.axes;
        item.scan = grid.scan;
      }
      if (!item.axes) {
        currentStage = '读取整图文字';
        const axisTokens = item.scan.tokens;
        item.scan = await engine.scan(canvas);
        item.rows = detectCatalogRows(pixels, item.scan.tokens);
        if (item.rows.length) item.regions = [];
        else if (item.regions.length) {
          item.axes = locateGridAxes(
            [...axisTokens, ...item.scan.tokens],
            item.regions,
            canvas.width,
            canvas.height,
          );
          if (!item.axes && item.regions.length >= 2) {
            currentStage = '加强识别星期与节次';
            progress.phase(`正在加强识别星期与节次（${file.name}）…`, decodeEnd, phaseEnd, 20);
            item.axes = (
              await readGridAxes(engine, canvas, item.regions, [...axisTokens, ...item.scan.tokens])
            ).axes;
          }
        }
      }
      progress.finish();
      releaseCanvas(canvas);
    }
    // Drop the mixed-language analysis worker before loading the digit verifier.
    currentStage = '结束图片版式分析';
    await engine.finishImageAnalysis();
    // The reference table is always processed first, even if selected second.
    const directoryRows = prepared.reduce((sum, item) => sum + item.rows.length, 0);
    let directoryIndex = 0;
    for (const item of prepared.filter((value) => value.rows.length)) {
      currentFile = item.file;
      currentStage = '解码课程目录';
      progress.phase(
        `正在解码课程目录（${item.file.name}）…`,
        0.15 + (0.25 * directoryIndex) / directoryRows,
        0.15 + (0.25 * directoryIndex) / directoryRows,
      );
      const canvas = await imageCanvas(item.file, options.signal);
      canvases.add(canvas);
      for (const [index, row] of item.rows.entries()) {
        checkAborted(options.signal);
        currentStage = `读取课程目录第 ${index + 1} 行`;
        progress.phase(
          `正在读取课程目录 ${directoryIndex + 1}/${directoryRows}（${item.file.name}）…`,
          0.15 + (0.25 * directoryIndex) / directoryRows,
          0.15 + (0.25 * (directoryIndex + 1)) / directoryRows,
          9,
        );
        const name =
          cachedCatalogField(item.scan, row.name) ??
          (await retryRegion(engine, canvas, row.name, true)).sort(
            (a, b) => b.confidence - a.confidence,
          )[0];
        const teacher = row.teacher
          ? (cachedCatalogField(item.scan, row.teacher) ??
            (await retryRegion(engine, canvas, row.teacher, true)).sort(
              (a, b) => b.confidence - a.confidence,
            )[0])
          : undefined;
        const code = row.code
          ? (cachedCatalogField(item.scan, row.code) ??
            (await retryRegion(engine, canvas, row.code, true)).sort(
              (a, b) => b.confidence - a.confidence,
            )[0])
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
        directoryIndex++;
        progress.finish();
      }
      releaseCanvas(canvas);
    }
    currentStage = '合并课程目录';
    const references = mergeCatalogReferences(catalog);
    const cardCount = prepared.reduce((sum, item) => sum + item.regions.length, 0);
    let cardIndex = 0;
    for (const item of prepared.filter((value) => !value.rows.length)) {
      currentFile = item.file;
      if (item.regions.length) {
        currentStage = '解码课表';
        progress.phase(
          `正在解码课表（${item.file.name}）…`,
          0.42 + (0.53 * cardIndex) / cardCount,
          0.42 + (0.53 * cardIndex) / cardCount,
        );
        const canvas = await imageCanvas(item.file, options.signal);
        canvases.add(canvas);
        const axes = item.axes;
        for (const region of item.regions) {
          checkAborted(options.signal);
          currentStage = `识别课程格 ${cardIndex + 1}/${cardCount}`;
          progress.phase(
            `正在识别课程格 ${cardIndex + 1}/${cardCount}（${item.file.name}）…`,
            0.42 + (0.53 * cardIndex) / cardCount,
            0.42 + (0.53 * (cardIndex + 1)) / cardCount,
            26,
          );
          drafts.push(
            await readCard(
              engine,
              canvas,
              inset(region),
              item.file.name,
              axes ? regionPlacement(region, axes) : null,
              references,
            ),
          );
          cardIndex++;
          progress.finish();
        }
        releaseCanvas(canvas);
      } else {
        currentStage = '解析识别文字';
        const parsed = item.scan.tokens.length
          ? parsePositionedText(item.scan.tokens, item.file.name)
          : parseTextBlocks(item.scan.text, item.file.name);
        drafts.push(...parsed);
      }
    }
    progress.phase('图片识别完成，正在合并课程…', 0.95, 0.97);
    progress.finish();
    return {
      drafts,
      catalog: references,
      sources: files.map((file, index) => ({ index, label: file.name })),
      warnings: [...new Set(warnings)],
    };
  } catch (error) {
    checkAborted(options.signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : String(error);
    // Decode errors already include the file and stage; do not repeat that prefix.
    if (currentFile && message.startsWith(`图片“${currentFile.name}” · `)) throw error;
    throw new Error(
      `${currentFile ? `图片“${currentFile.name}” · ` : ''}${currentStage}失败：${message}`,
    );
  } finally {
    try {
      await engine?.close();
    } finally {
      for (const canvas of canvases) releaseCanvas(canvas);
    }
  }
}
