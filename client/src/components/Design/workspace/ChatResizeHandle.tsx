import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { CHAT_WIDTH_MAX, CHAT_WIDTH_MIN, CHAT_WIDTH_STEP, clampChatWidth } from './chat-width';
import { useDesignLocalize } from '../i18n';

export default function ChatResizeHandle({
  width,
  onResize,
  onCommit,
}: {
  width: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  const localize = useDesignLocalize();
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, last: width };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return;
    }
    const next = clampChatWidth(drag.current.startWidth + event.clientX - drag.current.startX);
    drag.current.last = next;
    onResize(next);
  };

  const onPointerUp = () => {
    if (drag.current) {
      onCommit(drag.current.last);
      drag.current = null;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowLeft: width - CHAT_WIDTH_STEP,
      ArrowRight: width + CHAT_WIDTH_STEP,
      Home: CHAT_WIDTH_MIN,
      End: CHAT_WIDTH_MAX,
    };
    if (event.key in steps) {
      event.preventDefault();
      const next = clampChatWidth(steps[event.key]);
      onResize(next);
      onCommit(next);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={localize('workspace.layout.resize_chat')}
      aria-valuemin={CHAT_WIDTH_MIN}
      aria-valuemax={CHAT_WIDTH_MAX}
      aria-valuenow={width}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="group relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border-light focus-visible:outline-none"
    >
      <span className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-border-medium/40 group-focus-visible:bg-border-heavy/60" />
    </div>
  );
}
