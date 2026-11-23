import { Layer } from 'konva/lib/Layer';
import { Shape } from 'konva/lib/Shape';
import { Circle } from 'konva/lib/shapes/Circle';
import { Ellipse } from 'konva/lib/shapes/Ellipse';
import { Image as Photo } from 'konva/lib/shapes/Image';
import { Line } from 'konva/lib/shapes/Line';
import { Rect } from 'konva/lib/shapes/Rect';
import {
  arrowTips,
  emojiFont,
  font,
  png,
  type Bounds,
  type Mark,
  type Paper,
} from './drawing';

// The viewport supplies its own device-pixel dimensions. Cards and exports
// use explicit pixel dimensions independent of the display.
export function createLayer() {
  const layer = new Layer();
  layer.getCanvas().setPixelRatio(1);
  return layer;
}

function stroke(mark: Extract<Mark, { kind: 'ink' }>) {
  const first = mark.points[0];
  if (!first) return;
  const marker = mark.brush === 'marker';
  const width = marker ? 3 * mark.width : mark.width;
  const style = {
    opacity: marker ? 0.38 : 1,
    globalCompositeOperation:
      mark.brush === 'eraser' ? 'destination-out' : 'source-over',
  } as const;
  if (mark.brush === 'nib') {
    const d = width * 0.65;
    return new Shape({
      fill: mark.color,
      stroke: mark.color,
      strokeWidth: Math.max(1, width * 0.22),
      lineJoin: 'round',
      lineCap: 'round',
      sceneFunc(ctx, node) {
        let prev = first;
        for (const point of mark.points) {
          ctx.beginPath();
          ctx.moveTo(prev.x - d, prev.y + d);
          ctx.lineTo(point.x - d, point.y + d);
          ctx.lineTo(point.x + d, point.y - d);
          ctx.lineTo(prev.x + d, prev.y - d);
          ctx.closePath();
          ctx.fillStrokeShape(node);
          prev = point;
        }
      },
    });
  }
  if (mark.points.length === 1) {
    return marker
      ? new Rect({
          ...style,
          x: first.x - width / 2,
          y: first.y - width / 2,
          width,
          height: width,
          fill: mark.color,
        })
      : new Circle({ ...style, ...first, radius: width / 2, fill: mark.color });
  }
  const points: number[] = [];
  for (const p of mark.points) points.push(p.x, p.y);
  return new Line({
    ...style,
    points,
    stroke: mark.color,
    strokeWidth: width,
    lineCap: marker ? 'square' : 'round',
    lineJoin: 'round',
  });
}

function geometry(mark: Extract<Mark, { kind: 'shape' }>) {
  const { start, end } = mark;
  const width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y);
  const x = Math.min(start.x, end.x),
    y = Math.min(start.y, end.y);
  const style = {
    stroke: mark.color,
    strokeWidth: mark.width,
    lineJoin: 'round',
    lineCap: 'round',
    fill: mark.filled ? mark.color : undefined,
  } as const;
  switch (mark.shape) {
    case 'rect':
      return new Rect({ ...style, x, y, width, height });
    case 'ellipse':
      if (width && height)
        return new Ellipse({
          ...style,
          x: x + width / 2,
          y: y + height / 2,
          radiusX: width / 2,
          radiusY: height / 2,
        });
      break;
    case 'triangle':
      return new Line({
        ...style,
        closed: true,
        points: [(start.x + end.x) / 2, start.y, end.x, end.y, start.x, end.y],
      });
    case 'arrow': {
      const [left, right] = arrowTips(start, end, mark.width);
      return new Line({
        ...style,
        points: [
          start.x,
          start.y,
          end.x,
          end.y,
          left!.x,
          left!.y,
          end.x,
          end.y,
          right!.x,
          right!.y,
        ],
      });
    }
  }
  return new Line({ ...style, points: [start.x, start.y, end.x, end.y] });
}

export function drawingNode(
  mark: Mark,
  bitmap?: CanvasImageSource,
): Shape | undefined {
  switch (mark.kind) {
    case 'ink':
      return stroke(mark);
    case 'shape':
      return geometry(mark);
    case 'image':
      return bitmap
        ? new Photo({
            x: mark.at.x - mark.width / 2,
            y: mark.at.y - mark.height / 2,
            width: mark.width,
            height: mark.height,
            image: bitmap,
          })
        : undefined;
    case 'text':
    case 'sticker':
      // Older sheets store the native text baseline as the anchor. Keep it
      // identical to textBounds when clipping or fitting an exported sheet.
      return new Shape({
        ...mark.at,
        sceneFunc(ctx) {
          if (mark.kind === 'sticker') {
            ctx.font = mark.size + 'px ' + emojiFont;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.fillText(mark.symbol, 0, 0);
          } else {
            ctx.font = mark.size + 'px ' + font;
            ctx.fillStyle = mark.color;
            ctx.textBaseline = 'top';
            mark.text
              .split('\n')
              .forEach((line, i) =>
                ctx.fillText(line, 0, i * mark.size * 1.35),
              );
          }
        },
      });
  }
}

export function drawMark(layer: Layer, mark: Mark, bitmap?: CanvasImageSource) {
  const node = drawingNode(mark, bitmap);
  try {
    node?.drawScene(layer.getCanvas());
  } finally {
    node?.destroy();
  }
}

export async function exportPng(
  view: Bounds,
  paper: Paper,
  entries: ReadonlyArray<{ mark: Mark }>,
) {
  const scale = Math.min(1, 4096 / Math.max(view.width, view.height));
  const width = Math.max(1, Math.ceil(view.width * scale));
  const height = Math.max(1, Math.ceil(view.height * scale));
  const layer = createLayer();
  try {
    layer.getCanvas().setSize(width, height);
    const ctx = layer.getContext();
    ctx.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
    for (const { mark } of entries) {
      const bitmap =
        mark.kind === 'image' ? await createImageBitmap(mark.blob) : undefined;
      try {
        drawMark(layer, mark, bitmap);
      } finally {
        bitmap?.close();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    return await png(layer.getNativeCanvasElement());
  } finally {
    layer.destroy();
  }
}
