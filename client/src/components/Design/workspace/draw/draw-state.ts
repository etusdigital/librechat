import { useCallback, useMemo } from 'react';
import { atom, useAtom } from 'jotai';
import type { DrawShape, DrawTool } from './shapes';
import type { Size } from '../preview-geometry';
import { DEFAULT_DRAW_COLOR } from './palette';

export interface DrawSession {
  key: string;
  shapes: DrawShape[];
  past: DrawShape[][];
}

const emptySession = (key: string): DrawSession => ({ key, shapes: [], past: [] });

export function addShape(session: DrawSession, shape: DrawShape): DrawSession {
  return {
    ...session,
    shapes: [...session.shapes, shape],
    past: [...session.past, session.shapes],
  };
}

export function undoShapes(session: DrawSession): DrawSession {
  if (session.past.length === 0) {
    return session;
  }
  return {
    ...session,
    shapes: session.past[session.past.length - 1],
    past: session.past.slice(0, -1),
  };
}

export function clearShapes(session: DrawSession): DrawSession {
  if (session.shapes.length === 0) {
    return session;
  }
  return { ...session, shapes: [], past: [...session.past, session.shapes] };
}

export function drawSessionKey(projectId: string, path: string, viewport: Size) {
  return `${projectId}|${path}|${viewport.width}x${viewport.height}`;
}

export const drawSessionAtom = atom<DrawSession>(emptySession(''));
export const drawToolAtom = atom<DrawTool>('pen');
export const drawColorAtom = atom<string>(DEFAULT_DRAW_COLOR);
export const drawNoteAtom = atom('');

export function useDrawSession(key: string) {
  const [stored, setStored] = useAtom(drawSessionAtom);
  const session = stored.key === key ? stored : emptySession(key);

  const update = useCallback(
    (change: (current: DrawSession) => DrawSession) =>
      setStored((current) => change(current.key === key ? current : emptySession(key))),
    [key, setStored],
  );

  return useMemo(
    () => ({
      shapes: session.shapes,
      canUndo: session.past.length > 0,
      add: (shape: DrawShape) => update((current) => addShape(current, shape)),
      undo: () => update(undoShapes),
      clear: () => update(clearShapes),
      reset: () => update(() => emptySession(key)),
    }),
    [key, session.past.length, session.shapes, update],
  );
}
