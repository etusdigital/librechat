import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Button, Spinner } from '@librechat/client';
import { ArrowUpRight, Eraser, PenLine, Send, Square, Type, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkspaceModeContext } from '../modes/types';
import type { DesignTranslationKey } from '../../i18n';
import type { DrawTool } from './shapes';
import {
  drawColorAtom,
  drawNoteAtom,
  drawSessionKey,
  drawToolAtom,
  useDrawSession,
} from './draw-state';
import { captureScreenshot, screenshotDevice, ScreenshotError } from './screenshot';
import { designErrorMessageKey, isDesignApiError } from '../../api/errors';
import { useDesignChatActions } from '../../chat/DesignChatAdapter';
import { DRAW_COLORS, resolveDrawColor } from './palette';
import { useFocusWorkspaceTab } from '../workspace-tabs';
import { toolbarButton } from '../PreviewToolbar';
import { composeMarkedImage } from './compose';
import { useDesignLocalize } from '../../i18n';
import { cn } from '~/utils';

const TOOLS: { id: DrawTool; icon: LucideIcon; labelKey: DesignTranslationKey }[] = [
  { id: 'pen', icon: PenLine, labelKey: 'draw.tool_pen' },
  { id: 'rect', icon: Square, labelKey: 'draw.tool_rect' },
  { id: 'arrow', icon: ArrowUpRight, labelKey: 'draw.tool_arrow' },
  { id: 'text', icon: Type, labelKey: 'draw.tool_text' },
];

const pressed = 'bg-surface-active text-text-primary';

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent' }
  | { status: 'error'; messageKey: DesignTranslationKey };

export function drawMessage(note: string, reference: string) {
  return [note.trim(), reference].filter((part) => part !== '').join('\n\n');
}

function sendErrorKey(error: unknown): DesignTranslationKey {
  if (isDesignApiError(error)) {
    const key = designErrorMessageKey(error);
    return key === 'error_generic' ? 'draw.error_capture' : key;
  }
  if (error instanceof ScreenshotError && error.code === 'screenshot_timeout') {
    return 'draw.error_timeout';
  }
  if (
    error instanceof ScreenshotError ||
    (error instanceof Error && error.name === 'ComposeError')
  ) {
    return 'draw.error_capture';
  }
  return 'draw.error_composer';
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export default function DrawPanel({ project, path, device, geometry }: WorkspaceModeContext) {
  const localize = useDesignLocalize();
  const noteId = useId();
  const { viewport } = geometry;
  const session = useDrawSession(drawSessionKey(project.projectId, path, viewport));
  const [tool, setTool] = useAtom(drawToolAtom);
  const [colorId, setColorId] = useAtom(drawColorAtom);
  const [note, setNote] = useAtom(drawNoteAtom);
  const [state, setState] = useState<SendState>({ status: 'idle' });
  const { insertIntoComposer } = useDesignChatActions();
  const { focus } = useFocusWorkspaceTab();
  const abortRef = useRef<AbortController | null>(null);
  const { undo, canUndo } = session;
  const sending = state.status === 'sending';
  const target = screenshotDevice(device, viewport);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'z' &&
        !isEditable(event.target) &&
        canUndo
      ) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, undo]);

  const send = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'sending' });
    try {
      const screenshot = await captureScreenshot({
        projectId: project.projectId,
        path,
        device: target,
        signal: controller.signal,
      });
      const image = await composeMarkedImage(screenshot, session.shapes, viewport);
      const file = new File([image], localize('draw.file_name', { device: target }), {
        type: 'image/png',
      });
      const text = drawMessage(note, localize('draw.message_reference', { path }));
      if (!(await insertIntoComposer(text, [file]))) {
        throw new Error('composer_unavailable');
      }
      if (controller.signal.aborted) {
        return;
      }
      session.reset();
      setNote('');
      setState({ status: 'sent' });
      focus('chat');
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ status: 'error', messageKey: sendErrorKey(error) });
      }
    }
  }, [
    focus,
    insertIntoComposer,
    localize,
    note,
    path,
    project.projectId,
    session,
    setNote,
    target,
    viewport,
  ]);

  return (
    <div data-testid="design-draw-panel" className="flex flex-col gap-4 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={localize('draw.tools')} className="flex gap-0.5">
          {TOOLS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              aria-label={localize(labelKey)}
              title={localize(labelKey)}
              onClick={() => setTool(id)}
              className={cn(toolbarButton, tool === id && pressed)}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-0.5">
          <button
            type="button"
            aria-label={localize('draw.undo')}
            title={localize('draw.undo')}
            disabled={!canUndo || sending}
            onClick={undo}
            className={toolbarButton}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={localize('draw.clear')}
            title={localize('draw.clear')}
            disabled={session.shapes.length === 0 || sending}
            onClick={session.clear}
            className={toolbarButton}
          >
            <Eraser className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div role="radiogroup" aria-label={localize('draw.colors')} className="flex flex-wrap gap-2">
        {DRAW_COLORS.map((color) => (
          <button
            key={color.id}
            type="button"
            role="radio"
            aria-checked={colorId === color.id}
            aria-label={localize(color.labelKey)}
            title={localize(color.labelKey)}
            onClick={() => setColorId(color.id)}
            className={cn(
              'flex size-8 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
              colorId === color.id ? 'border-text-primary' : 'border-transparent',
            )}
          >
            <span
              aria-hidden="true"
              className="size-5 rounded-full border border-border-medium"
              style={{ backgroundColor: resolveDrawColor(color.id) }}
            />
          </button>
        ))}
      </div>
      <p className="text-text-secondary">
        {localize(device === 'free' ? 'draw.hint_free' : 'draw.hint', {
          device: localize(`workspace.preview.device_${target}`),
        })}
      </p>
      {project.canWrite ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label htmlFor={noteId} className="font-medium text-text-primary">
            {localize('draw.note_label')}
          </label>
          <textarea
            id={noteId}
            value={note}
            rows={3}
            maxLength={2000}
            placeholder={localize('draw.note_placeholder')}
            onChange={(event) => setNote(event.target.value)}
            className="w-full resize-y rounded-md border border-border-light bg-surface-primary px-2 py-1.5 text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
          />
          <Button
            type="submit"
            disabled={session.shapes.length === 0 || sending}
            className="gap-2 self-start"
          >
            {sending ? (
              <Spinner className="size-4" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {localize('draw.send')}
          </Button>
          <div aria-live="polite" className="min-h-5">
            {state.status === 'sending' ? (
              <p className="text-text-secondary">{localize('draw.sending')}</p>
            ) : null}
            {state.status === 'sent' ? (
              <p className="text-text-secondary">{localize('draw.sent')}</p>
            ) : null}
          </div>
          {state.status === 'error' ? (
            <p role="alert" className="text-text-primary">
              {localize(state.messageKey)}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-text-secondary">{localize('draw.read_only')}</p>
      )}
    </div>
  );
}
