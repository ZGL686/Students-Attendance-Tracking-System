import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Inspect CSS colors and alpha layers, never pixels from the user's wallpaper. */
export async function expectReadable(page: Page, selector: string, state: string) {
  const result = await page.evaluate((selector) => {
    type Color = { r: number; g: number; b: number; a: number };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 1, g: 1, b: 1, a: 1 };
    const parse = (value: string): Color => {
      const values = value.match(/[\d.]+%?/g) ?? [];
      const srgb = value.startsWith('color(srgb');
      const channel = (input: string) =>
        Number.parseFloat(input) / (input.endsWith('%') ? 100 : srgb ? 1 : 255);
      if (values.length < 3) throw new Error(`Unsupported computed CSS color: ${value}`);
      return {
        r: channel(values[0]!),
        g: channel(values[1]!),
        b: channel(values[2]!),
        a: values[3] ? Number.parseFloat(values[3]) / (values[3].endsWith('%') ? 100 : 1) : 1,
      };
    };
    const over = (front: Color, back: Color): Color => ({
      r: front.r * front.a + back.r * (1 - front.a),
      g: front.g * front.a + back.g * (1 - front.a),
      b: front.b * front.a + back.b * (1 - front.a),
      a: 1,
    });
    const luminance = (color: Color) => {
      const linear = (channel: number) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return linear(color.r) * 0.2126 + linear(color.g) * 0.7152 + linear(color.b) * 0.0722;
    };
    const ratio = (first: number, second: number) =>
      (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.getClientRects().length > 0
      );
    };
    const path = (element: Element) =>
      `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')}`;
    const issues: object[] = [];
    let checked = 0;
    const sample = (element: Element, kind: 'text' | 'icon' | 'placeholder', text: string) => {
      const style = getComputedStyle(element, kind === 'placeholder' ? '::placeholder' : undefined);
      const foreground = parse(
        kind === 'icon' && style.stroke !== 'none' ? style.stroke : style.color,
      );
      const layers: Color[][] = [];
      let opacity = kind === 'placeholder' ? Number.parseFloat(style.opacity) : 1,
        image = false;
      for (let current: Element | null = element; current; current = current.parentElement) {
        const currentStyle = getComputedStyle(current);
        opacity *= Number.parseFloat(currentStyle.opacity);
        if (currentStyle.backgroundImage !== 'none') {
          const backgroundImage = currentStyle.backgroundImage;
          const stops = backgroundImage.match(/(?:rgba?\([^()]+\)|color\(srgb[^()]+\))/g);
          if (
            backgroundImage.startsWith('linear-gradient(') &&
            !backgroundImage.includes('url(') &&
            stops &&
            stops.length >= 2
          )
            layers.push(stops.map(parse));
          else {
            image = true;
            break;
          }
        }
        const background = parse(currentStyle.backgroundColor);
        layers.push([background]);
        if (background.a >= 0.9999) break;
      }
      const compose = (backdrop: Color, endpoint: 'min' | 'max') =>
        [...layers].reverse().reduce((background, stops) => {
          const colors = stops.map((stop) => over(stop, background));
          return {
            r: Math[endpoint](...colors.map((color) => color.r)),
            g: Math[endpoint](...colors.map((color) => color.g)),
            b: Math[endpoint](...colors.map((color) => color.b)),
            a: 1,
          };
        }, backdrop);
      const low = compose(black, 'min'),
        high = compose(white, 'max');
      const lowL = luminance(low),
        highL = luminance(high),
        foregroundL = luminance(foreground);
      // Every possible wallpaper lies between these extrema. An interior crossing
      // has contrast 1 even when both sampled endpoints appear acceptable.
      const worst =
        foregroundL >= Math.min(lowL, highL) && foregroundL <= Math.max(lowL, highL)
          ? 1
          : Math.min(
              ratio(luminance(over(foreground, low)), lowL),
              ratio(luminance(over(foreground, high)), highL),
            );
      const target = kind === 'icon' ? 3 : 4.5;
      checked++;
      if (worst + 0.005 < target || opacity < 0.999)
        issues.push({
          element: path(element),
          kind,
          text: text.slice(0, 75),
          color: style.color,
          worst: Number(worst.toFixed(3)),
          target,
          opacity,
          wallpaperBehind: image,
          low: Number(lowL.toFixed(3)),
          high: Number(highL.toFixed(3)),
        });
    };
    const seen = new Set<Element>();
    for (const root of document.querySelectorAll(selector)) {
      for (const element of [root, ...root.querySelectorAll('*')]) {
        if (seen.has(element) || !visible(element)) continue;
        seen.add(element);
        if (element.matches('svg')) {
          sample(element, 'icon', element.closest('button')?.getAttribute('aria-label') ?? 'icon');
          continue;
        }
        if (element.closest('svg') || element.matches('option, script, style, progress')) continue;
        const directText = Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .trim();
        if (directText) sample(element, 'text', directText);
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          if (element.value && !['checkbox', 'radio', 'range', 'file'].includes(element.type))
            sample(element, 'text', element.value);
          else if (element.placeholder) sample(element, 'placeholder', element.placeholder);
        }
        if (element instanceof HTMLSelectElement)
          sample(element, 'text', element.selectedOptions[0]?.text ?? 'select');
      }
    }
    return { checked, issues };
  }, selector);
  expect(result.checked, `${state}: no readable elements sampled`).toBeGreaterThan(0);
  expect(result.issues, `${state}: ${JSON.stringify(result.issues, null, 2)}`).toEqual([]);
  return result.checked;
}
