export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number };
export type Brush = 'round' | 'nib' | 'marker';
export type Shape = 'rect' | 'ellipse' | 'triangle' | 'line' | 'arrow';
export type Tool =
  'brush' | 'shape' | 'arrow' | 'text' | 'eraser' | 'sticker' | 'hand';
export type Paper = '#ffffff' | '#000000';

export interface PenSettings {
  brush: Brush;
  shape: Shape;
  color: string;
  width: number;
  eraserWidth: number;
  textSize: number;
  stickerSize: number;
  filled: boolean;
}
export type Mark =
  | {
      kind: 'ink';
      brush: Brush | 'eraser';
      color: string;
      width: number;
      points: Point[];
    }
  | {
      kind: 'shape';
      shape: Shape;
      color: string;
      width: number;
      filled: boolean;
      start: Point;
      end: Point;
    }
  | { kind: 'text'; at: Point; color: string; size: number; text: string }
  | { kind: 'sticker'; at: Point; size: number; symbol: string }
  | { kind: 'image'; at: Point; width: number; height: number; blob: Blob };

export const font = '"Segoe UI", "Microsoft YaHei", sans-serif';
export const emojiFont = '"Segoe UI Emoji", sans-serif';
export const palette = [
  ['墨黑', '#20282b'],
  ['岩灰', '#75828c'],
  ['纯白', '#ffffff'],
  ['珊瑚', '#eb7365'],
  ['琥珀', '#f2b94e'],
  ['青绿', '#16816f'],
  ['湖蓝', '#5089cf'],
  ['紫藤', '#a178be'],
] as const;

function box(left: number, top: number, right: number, bottom: number): Bounds {
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return box(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x + a.width, b.x + b.width),
    Math.max(a.y + a.height, b.y + b.height),
  );
}

function around(points: Point[], radius: number): Bounds {
  const first = points[0];
  if (!first) return box(0, 0, 0, 0);
  let left = first.x,
    right = first.x,
    top = first.y,
    bottom = first.y;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return box(left - radius, top - radius, right + radius, bottom + radius);
}

export function arrowTips(start: Point, end: Point, width: number): Point[] {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const tip = Math.min(Math.hypot(dx, dy) * 0.55, Math.max(19, width * 4));
  return [-0.52, 0.52].map((offset) => ({
    x: end.x - tip * Math.cos(angle + offset),
    y: end.y - tip * Math.sin(angle + offset),
  }));
}

let measurement: CanvasRenderingContext2D | undefined;
function textBounds(mark: Extract<Mark, { kind: 'text' | 'sticker' }>): Bounds {
  const ctx = (measurement ??= createSurface(1, 1).getContext('2d')!);
  const centered = mark.kind === 'sticker';
  ctx.font = mark.size + 'px ' + (centered ? emojiFont : font);
  ctx.textAlign = centered ? 'center' : 'start';
  ctx.textBaseline = centered ? 'middle' : 'top';
  const lines = centered ? [mark.symbol] : mark.text.split('\n');
  let result: Bounds | undefined;
  for (const [i, line] of lines.entries()) {
    const m = ctx.measureText(line);
    const y = mark.at.y + i * mark.size * 1.35;
    const area = box(
      mark.at.x - m.actualBoundingBoxLeft,
      y - m.actualBoundingBoxAscent,
      mark.at.x + m.actualBoundingBoxRight,
      y + m.actualBoundingBoxDescent,
    );
    if (area.width > 0 && area.height > 0)
      result = result ? unionBounds(result, area) : area;
  }
  return result ?? { ...mark.at, width: 0, height: 0 };
}

/** World-space footprint, also used to cull erasers while replaying ink. */
export function markBounds(mark: Mark): Bounds {
  switch (mark.kind) {
    case 'ink': {
      // The far corner of a square cap can project beyond half a line width.
      let radius = mark.width / 2;
      if (mark.brush === 'marker') radius = mark.width * 3 * Math.SQRT1_2;
      if (mark.brush === 'nib')
        radius = mark.width * 0.65 + Math.max(1, mark.width * 0.22) / 2;
      return around(mark.points, radius);
    }
    case 'shape': {
      const points = [mark.start, mark.end];
      if (mark.shape === 'arrow')
        points.push(...arrowTips(mark.start, mark.end, mark.width));
      return around(points, mark.width / 2);
    }
    case 'image':
      return {
        x: mark.at.x - mark.width / 2,
        y: mark.at.y - mark.height / 2,
        width: mark.width,
        height: mark.height,
      };
    case 'text':
    case 'sticker':
      return textBounds(mark);
  }
}

export function createSurface(width: number, height: number) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return el;
}
export function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error('图片生成失败'))),
      'image/png',
    ),
  );
}

export interface StampImage {
  blob: Blob;
  source: HTMLCanvasElement;
  name: string;
}
export async function importStamp(file: File): Promise<StampImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const source = createSurface(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    source
      .getContext('2d')!
      .drawImage(bitmap, 0, 0, source.width, source.height);
    return { blob: await png(source), source, name: file.name };
  } finally {
    bitmap.close();
  }
}
