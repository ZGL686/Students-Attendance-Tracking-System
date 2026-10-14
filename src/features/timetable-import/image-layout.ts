import type { PositionedText } from './parse';

export type ImageRect = { x: number; y: number; width: number; height: number };
export type PixelImage = { width: number; height: number; data: Uint8ClampedArray };
export type GridAxes = {
  days: { day: number; x: number }[];
  periods: { period: number; y: number }[];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The pale calendar background is excluded, while white lettering stays inside a card. */
export function detectColoredRegions(image: PixelImage): ImageRect[] {
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const foreground = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const offset = (sourceY * image.width + sourceX) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      if (
        image.data[offset + 3] > 127 &&
        maximum > 55 &&
        maximum - minimum > 40 &&
        (maximum - minimum) / maximum > 0.24
      )
        foreground[y * width + x] = 1;
    }
  }
  const queue = new Int32Array(width * height);
  const result: ImageRect[] = [];
  for (let origin = 0; origin < foreground.length; origin++) {
    if (!foreground[origin]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = origin;
    foreground[origin] = 0;
    let minX = origin % width;
    let maxX = minX;
    let minY = Math.floor(origin / width);
    let maxY = minY;
    while (head < tail) {
      const point = queue[head++];
      const x = point % width;
      const y = Math.floor(point / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = ny * width + nx;
          if (!foreground[next]) continue;
          foreground[next] = 0;
          queue[tail++] = next;
        }
    }
    const regionWidth = maxX - minX + 1;
    const regionHeight = maxY - minY + 1;
    if (
      regionWidth < Math.max(10, width * 0.035) ||
      regionWidth > width * 0.4 ||
      regionHeight < Math.max(16, height * 0.025) ||
      regionHeight > height * 0.94 ||
      tail / (regionWidth * regionHeight) < 0.45
    )
      continue;
    const x = Math.max(0, Math.floor(minX / scale));
    const y = Math.max(0, Math.floor(minY / scale));
    result.push({
      x,
      y,
      width: Math.min(image.width - x, Math.ceil(regionWidth / scale)),
      height: Math.min(image.height - y, Math.ceil(regionHeight / scale)),
    });
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x);
}

type AxisAnchor = { value: number; position: number };
type AxisFit = { step: number; offset: number; anchors: AxisAnchor[]; error: number };

/** Choose a consistent majority, then refine it without relying on consecutive OCR labels. */
function fitAxis(anchors: AxisAnchor[], minimumStep: number, maximumStep: number) {
  let best: AxisFit | undefined;
  const contenders: AxisFit[] = [];
  for (let first = 0; first < anchors.length; first++)
    for (let second = first + 1; second < anchors.length; second++) {
      const a = anchors[first];
      const b = anchors[second];
      if (a.value === b.value) continue;
      const step = (b.position - a.position) / (b.value - a.value);
      if (step < minimumStep || step > maximumStep) continue;
      const offset = a.position - step * a.value;
      const tolerance = Math.max(4, step * 0.18);
      const matches = anchors.filter(
        (anchor) => Math.abs(anchor.position - (offset + step * anchor.value)) <= tolerance,
      );
      const unique = [...new Set(matches.map((anchor) => anchor.value))].map((value) => {
        const alternatives = matches.filter((anchor) => anchor.value === value);
        return alternatives.reduce((chosen, anchor) =>
          Math.abs(anchor.position - (offset + step * value)) <
          Math.abs(chosen.position - (offset + step * value))
            ? anchor
            : chosen,
        );
      });
      if (unique.length < 3) continue;
      const error = unique.reduce(
        (sum, anchor) => sum + Math.abs(anchor.position - (offset + step * anchor.value)),
        0,
      );
      if (!best || unique.length > best.anchors.length) contenders.length = 0;
      if (!best || unique.length >= best.anchors.length)
        contenders.push({ step, offset, anchors: unique, error });
      if (
        !best ||
        unique.length > best.anchors.length ||
        (unique.length === best.anchors.length && error < best.error)
      )
        best = { step, offset, anchors: unique, error };
    }
  if (!best) return undefined;
  const bounds = [
    Math.min(...anchors.map((anchor) => anchor.value)),
    Math.max(...anchors.map((anchor) => anchor.value)),
  ];
  const chosen = best;
  const ambiguous = contenders.some((candidate) => {
    const spacing = Math.min(candidate.step, chosen.step);
    const comparableError = Math.max(2, spacing * 0.03) * chosen.anchors.length;
    return (
      candidate.error <= chosen.error + comparableError &&
      bounds.some(
        (value) =>
          Math.abs(
            candidate.offset + candidate.step * value - chosen.offset - chosen.step * value,
          ) > Math.max(4, spacing * 0.18),
      )
    );
  });
  // Multiple OCR passes must agree on the axis; input order is not evidence for choosing one.
  if (ambiguous) return undefined;
  const steps: number[] = [];
  for (let first = 0; first < best.anchors.length; first++)
    for (let second = first + 1; second < best.anchors.length; second++) {
      const a = best.anchors[first];
      const b = best.anchors[second];
      steps.push((b.position - a.position) / (b.value - a.value));
    }
  const step = median(steps);
  return {
    step,
    offset: median(best.anchors.map((anchor) => anchor.position - anchor.value * step)),
    anchors: best.anchors,
  };
}

function weekday(token: PositionedText) {
  const text = token.text.replace(/\s+/g, '').replace('天', '日');
  const match = text.match(/^(?:星期|周|礼拜)?([一二三四五六日])$/);
  return match ? '一二三四五六日'.indexOf(match[1]) + 1 : undefined;
}

/** OCR may keep a complete calendar-heading row in one word instead of seven. */
function splitWeekdayTokens(tokens: PositionedText[]): PositionedText[] {
  return tokens.flatMap((token) => {
    const text = token.text.replace(/\s+/g, '').replaceAll('天', '日');
    const matches = [...text.matchAll(/(?:星期|周|礼拜)?[一二三四五六日]/g)];
    if (matches.length < 2 || matches.map((match) => match[0]).join('') !== text) return [token];
    const days = matches.map((match) => '一二三四五六日'.indexOf(match[0].at(-1)!) + 1);
    // Repeated or reversed words may belong to prose; only a calendar row is split.
    if (days.some((day, index) => index > 0 && day !== days[index - 1] + 1)) return [token];
    const glyphWidth = Math.min(token.height, token.width / matches.length);
    const firstWidth = Math.min(token.width / matches.length, glyphWidth * matches[0][0].length);
    const lastWidth = Math.min(
      token.width / matches.length,
      glyphWidth * matches.at(-1)![0].length,
    );
    const firstCenter = token.x + firstWidth / 2;
    const lastCenter = token.x + token.width - lastWidth / 2;
    return matches.map((match, index) => ({
      ...token,
      text: match[0],
      x: firstCenter + ((lastCenter - firstCenter) * index) / (matches.length - 1) - glyphWidth / 2,
      width: glyphWidth,
    }));
  });
}

export function locateGridAxes(
  tokens: PositionedText[],
  regions: ImageRect[],
  width: number,
  height: number,
): GridAxes | null {
  if (!regions.length) return null;
  const firstCardY = Math.min(...regions.map((region) => region.y));
  const headings = splitWeekdayTokens(tokens)
    .map((token) => ({ token, day: weekday(token) }))
    .filter(
      (item): item is { token: PositionedText; day: number } =>
        item.day !== undefined &&
        item.token.y + item.token.height <= firstCardY &&
        item.token.y < height * 0.35,
    );
  const headers: { fit: NonNullable<ReturnType<typeof fitAxis>>; y: number }[] = [];
  for (const candidate of headings) {
    const centerY = candidate.token.y + candidate.token.height / 2;
    const row = headings.filter(
      ({ token }) =>
        Math.abs(token.y + token.height / 2 - centerY) <=
        Math.max(16, token.height, candidate.token.height) * 0.8,
    );
    const fit = fitAxis(
      row.map(({ token, day }) => ({ value: day, position: token.x + token.width / 2 })),
      width * 0.05,
      width * 0.5,
    );
    if (fit) headers.push({ fit, y: median(row.map(({ token }) => token.y + token.height / 2)) });
  }
  const header = headers.reduce<(typeof headers)[number] | undefined>(
    (best, candidate) =>
      !best || candidate.fit.anchors.length > best.fit.anchors.length ? candidate : best,
    undefined,
  );
  if (!header) return null;
  // Equally supported but conflicting heading rows cannot establish a reliable weekday.
  // Near-identical normal/scaled scans of the same row remain valid within the fitting tolerance.
  const ambiguous = headers.some(
    (candidate) =>
      candidate.fit.anchors.length === header.fit.anchors.length &&
      [1, 7].some(
        (day) =>
          Math.abs(
            candidate.fit.offset +
              candidate.fit.step * day -
              header.fit.offset -
              header.fit.step * day,
          ) > Math.max(4, Math.min(candidate.fit.step, header.fit.step) * 0.18),
      ),
  );
  if (ambiguous) return null;
  const days = Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    x: header.fit.offset + header.fit.step * (index + 1),
  })).filter((day) => day.x > 0 && day.x < width);
  const sidebarRight = (days[0]?.x ?? width) - header.fit.step * 0.52;
  const anchors = tokens.flatMap((token) => {
    const text = token.text
      .replace(/\s+/g, '')
      .replace(/[０-９]/g, (character) => String(character.charCodeAt(0) - 0xff10));
    const match = text.match(/^(?:第)?([1-9]|10)(?:节)?$/);
    if (
      !match ||
      token.x + token.width > sidebarRight ||
      token.y + token.height / 2 <= header.y + Math.max(8, token.height) ||
      token.height < 5
    )
      return [];
    return [{ value: Number(match[1]), position: token.y + token.height / 2 }];
  });
  const periodFit = fitAxis(anchors, height * 0.025, height * 0.3);
  if (!periodFit) return null;
  const periods = Array.from({ length: 10 }, (_, index) => ({
    period: index + 1,
    y: periodFit.offset + periodFit.step * (index + 1),
  })).filter((period) => period.y > header.y && period.y < height);
  if (periods.length < 2) return null;
  return { days, periods };
}

export function regionPlacement(rect: ImageRect, axes: GridAxes) {
  if (!axes.days.length || axes.periods.length < 2) return null;
  const daySpacing = median(axes.days.slice(1).map((day, index) => day.x - axes.days[index].x));
  if (!Number.isFinite(daySpacing) || daySpacing <= 0) return null;
  const center = rect.x + rect.width / 2;
  const day = axes.days.reduce((chosen, candidate) =>
    Math.abs(candidate.x - center) < Math.abs(chosen.x - center) ? candidate : chosen,
  );
  if (Math.abs(day.x - center) > daySpacing * 0.42 || rect.width > daySpacing * 1.18) return null;
  const periods = axes.periods.filter(
    (period) => period.y >= rect.y && period.y <= rect.y + rect.height,
  );
  if (!periods.length) return null;
  return { day: day.day, start: periods[0].period, end: periods[periods.length - 1].period };
}
