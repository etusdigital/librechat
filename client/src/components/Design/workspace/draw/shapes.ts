export interface Point {
  x: number;
  y: number;
}

export const DRAW_TOOLS = ['pen', 'rect', 'arrow', 'text'] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];

export type DrawShape =
  | { kind: 'pen'; color: string; points: Point[] }
  | { kind: 'rect'; color: string; from: Point; to: Point }
  | { kind: 'arrow'; color: string; from: Point; to: Point }
  | { kind: 'text'; color: string; at: Point; text: string };

export type StrokeTool = Exclude<DrawTool, 'text'>;

export const STROKE_WIDTH = 4;
export const ARROW_HEAD = 18;
export const TEXT_SIZE = 20;
export const TEXT_MAX = 80;
export const TEXT_FONT = `600 ${TEXT_SIZE}px system-ui, -apple-system, "Segoe UI", sans-serif`;
const TEXT_HALO = 'rgba(255, 255, 255, 0.9)';
const MIN_DRAG = 4;

export function startShape(tool: StrokeTool, color: string, point: Point): DrawShape {
  if (tool === 'pen') {
    return { kind: 'pen', color, points: [point] };
  }
  return { kind: tool, color, from: point, to: point };
}

export function extendShape(shape: DrawShape, point: Point): DrawShape {
  switch (shape.kind) {
    case 'pen':
      return { ...shape, points: [...shape.points, point] };
    case 'rect':
    case 'arrow':
      return { ...shape, to: point };
    default:
      return shape;
  }
}

export function textShape(color: string, at: Point, text: string): DrawShape | null {
  const trimmed = text.trim().slice(0, TEXT_MAX);
  return trimmed ? { kind: 'text', color, at, text: trimmed } : null;
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function isMeaningful(shape: DrawShape): boolean {
  switch (shape.kind) {
    case 'pen':
      return shape.points.length > 1;
    case 'rect':
      return (
        Math.abs(shape.to.x - shape.from.x) >= MIN_DRAG &&
        Math.abs(shape.to.y - shape.from.y) >= MIN_DRAG
      );
    case 'arrow':
      return distance(shape.from, shape.to) >= MIN_DRAG;
    case 'text':
      return shape.text.trim() !== '';
  }
}

function paintArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - ARROW_HEAD * Math.cos(angle - spread),
    to.y - ARROW_HEAD * Math.sin(angle - spread),
  );
  ctx.lineTo(
    to.x - ARROW_HEAD * Math.cos(angle + spread),
    to.y - ARROW_HEAD * Math.sin(angle + spread),
  );
  ctx.closePath();
  ctx.fill();
}

function paintShape(ctx: CanvasRenderingContext2D, shape: DrawShape) {
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (shape.kind) {
    case 'pen': {
      const [first, ...rest] = shape.points;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      rest.forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.stroke();
      return;
    }
    case 'rect':
      ctx.strokeRect(
        Math.min(shape.from.x, shape.to.x),
        Math.min(shape.from.y, shape.to.y),
        Math.abs(shape.to.x - shape.from.x),
        Math.abs(shape.to.y - shape.from.y),
      );
      return;
    case 'arrow':
      paintArrow(ctx, shape.from, shape.to);
      return;
    case 'text':
      ctx.font = TEXT_FONT;
      ctx.textBaseline = 'top';
      ctx.strokeStyle = TEXT_HALO;
      ctx.strokeText(shape.text, shape.at.x, shape.at.y);
      ctx.fillText(shape.text, shape.at.x, shape.at.y);
  }
}

export function paintShapes(ctx: CanvasRenderingContext2D, shapes: readonly DrawShape[]) {
  for (const shape of shapes) {
    ctx.save();
    paintShape(ctx, shape);
    ctx.restore();
  }
}
