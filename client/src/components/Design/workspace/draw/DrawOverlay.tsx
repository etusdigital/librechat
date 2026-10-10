import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { WorkspaceModeContext } from '../modes/types';
import type { DrawShape, Point } from './shapes';
import {
  extendShape,
  isMeaningful,
  paintShapes,
  startShape,
  textShape,
  TEXT_FONT,
  TEXT_MAX,
} from './shapes';
import { drawColorAtom, drawSessionKey, drawToolAtom, useDrawSession } from './draw-state';
import { useDesignLocalize } from '../../i18n';
import { resolveDrawColor } from './palette';

const MAX_PIXEL_RATIO = 3;

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

export default function DrawOverlay({ project, path, geometry, bridge }: WorkspaceModeContext) {
  const localize = useDesignLocalize();
  const { viewport, scale } = geometry;
  const session = useDrawSession(drawSessionKey(project.projectId, path, viewport));
  const { shapes, add } = session;
  const tool = useAtomValue(drawToolAtom);
  const colorId = useAtomValue(drawColorAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draftRef = useRef<DrawShape | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<{ at: Point; value: string; color: string } | null>(null);
  const { reload } = bridge;
  const loadedBeforeDrawing = useRef(bridge.ready != null);

  useEffect(() => {
    if (loadedBeforeDrawing.current) {
      loadedBeforeDrawing.current = false;
      reload();
    }
  }, [reload]);

  const textOpen = text != null;
  useEffect(() => {
    if (textOpen) {
      textRef.current?.focus();
    }
  }, [textOpen]);

  const pixelRatio = Math.min(
    MAX_PIXEL_RATIO,
    Math.max(1, (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) * scale),
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    paintShapes(ctx, draftRef.current ? [...shapes, draftRef.current] : shapes);
  }, [pixelRatio, shapes]);

  useEffect(() => {
    paint();
  }, [paint, viewport.width, viewport.height]);

  const pointOf = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const factorX = rect.width > 0 ? viewport.width / rect.width : 1;
    const factorY = rect.height > 0 ? viewport.height / rect.height : 1;
    return {
      x: clamp((event.clientX - rect.left) * factorX, viewport.width),
      y: clamp((event.clientY - rect.top) * factorY, viewport.height),
    };
  };

  const commitText = () => {
    if (!text) {
      return;
    }
    const shape = textShape(text.color, text.at, text.value);
    if (shape) {
      add(shape);
    }
    setText(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const point = pointOf(event);
    const color = resolveDrawColor(colorId);
    if (tool === 'text') {
      if (text) {
        commitText();
      } else {
        setText({ at: point, value: '', color });
      }
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draftRef.current = startShape(tool, color, point);
    paint();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!draftRef.current) {
      return;
    }
    draftRef.current = extendShape(draftRef.current, pointOf(event));
    paint();
  };

  const finish = () => {
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft && isMeaningful(draft)) {
      add(draft);
    } else {
      paint();
    }
  };

  const onTextKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitText();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setText(null);
    }
  };

  return (
    <div data-testid="design-draw-overlay" className="absolute inset-0 z-10">
      <canvas
        ref={canvasRef}
        data-testid="design-draw-canvas"
        data-shapes={shapes.length}
        aria-label={localize('draw.canvas_label')}
        width={Math.round(viewport.width * pixelRatio)}
        height={Math.round(viewport.height * pixelRatio)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="absolute inset-0 size-full cursor-crosshair touch-none"
      />
      {text ? (
        <input
          ref={textRef}
          type="text"
          value={text.value}
          maxLength={TEXT_MAX}
          aria-label={localize('draw.text_input')}
          placeholder={localize('draw.text_placeholder')}
          onChange={(event) => setText({ ...text, value: event.target.value })}
          onKeyDown={onTextKeyDown}
          onBlur={commitText}
          style={{
            left: text.at.x,
            top: text.at.y,
            color: text.color,
            font: TEXT_FONT,
            maxWidth: Math.max(viewport.width - text.at.x, 80),
          }}
          className="absolute min-w-40 rounded border border-dashed border-current bg-white/80 px-1 py-0 outline-none"
        />
      ) : null}
    </div>
  );
}
