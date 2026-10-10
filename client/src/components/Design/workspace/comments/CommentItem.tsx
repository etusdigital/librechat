import { useId } from 'react';
import { Button, Spinner } from '@librechat/client';
import { CheckCircle2, RotateCcw, Send } from 'lucide-react';
import type { DesignTranslationKey } from '../../i18n';
import type { DesignComment } from '../../api/types';
import { useDesignLocalize } from '../../i18n';
import { cn } from '~/utils';

const DEVICE_KEYS: Record<string, DesignTranslationKey> = {
  mobile: 'workspace.preview.device_mobile',
  tablet: 'workspace.preview.device_tablet',
  desktop: 'workspace.preview.device_desktop',
  free: 'workspace.preview.device_free',
};

function StatusIcon({ busy, open }: { busy: boolean; open: boolean }) {
  if (busy) {
    return <Spinner className="size-3" />;
  }
  const Icon = open ? CheckCircle2 : RotateCcw;
  return <Icon className="size-3.5" aria-hidden="true" />;
}

export default function CommentItem({
  comment,
  number,
  selected,
  canChangeStatus,
  chatSelectable,
  chatSelected,
  busy,
  onSelect,
  onToggleChat,
  onChangeStatus,
}: {
  comment: DesignComment;
  number: number;
  selected: boolean;
  canChangeStatus: boolean;
  chatSelectable: boolean;
  chatSelected: boolean;
  busy: boolean;
  onSelect: () => void;
  onToggleChat: (checked: boolean) => void;
  onChangeStatus: () => void;
}) {
  const localize = useDesignLocalize();
  const bodyId = useId();
  const open = comment.status === 'open';
  const deviceKey = DEVICE_KEYS[comment.anchor.device];
  const target = comment.anchor.textSnippet.trim() || comment.anchor.selector;
  return (
    <li
      data-testid="comment-item"
      data-comment-id={comment.commentId}
      data-status={comment.status}
      className={cn(
        'flex gap-2 rounded-lg border p-2.5',
        selected ? 'border-border-heavy bg-surface-active' : 'border-border-light',
      )}
    >
      {chatSelectable ? (
        <input
          type="checkbox"
          checked={chatSelected}
          aria-label={localize('comments.select_for_chat', { number })}
          onChange={(event) => onToggleChat(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-text-primary"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <button
          type="button"
          aria-pressed={selected}
          aria-describedby={bodyId}
          onClick={onSelect}
          className="flex min-w-0 flex-col items-start gap-0.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <span className="text-xs font-medium text-text-secondary">
            {localize('comments.show_in_preview', { number })}
          </span>
          <span
            className="w-full truncate text-xs text-text-secondary"
            title={comment.anchor.selector}
          >
            {target}
          </span>
        </button>
        <p id={bodyId} className="whitespace-pre-wrap break-words text-sm text-text-primary">
          {comment.body}
        </p>
        <p className="text-xs text-text-secondary">
          {localize('comments.meta', {
            author: comment.authorName,
            version: comment.version,
            device: deviceKey ? localize(deviceKey) : comment.anchor.device,
          })}
        </p>
        {comment.resolvedNote ? (
          <p className="text-xs text-text-secondary">
            {localize('comments.resolved_note', { note: comment.resolvedNote })}
          </p>
        ) : null}
        {open && comment.sentToChatAt ? (
          <p className="flex items-center gap-1 text-xs text-text-secondary">
            <Send className="size-3" aria-hidden="true" />
            {localize('comments.sent_badge')}
          </p>
        ) : null}
        {canChangeStatus ? (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-busy={busy}
              aria-label={localize(open ? 'comments.resolve_label' : 'comments.reopen_label', {
                number,
              })}
              onClick={onChangeStatus}
              className="h-7 gap-1 px-2 text-xs"
            >
              <StatusIcon busy={busy} open={open} />
              {localize(open ? 'comments.resolve' : 'comments.reopen')}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
