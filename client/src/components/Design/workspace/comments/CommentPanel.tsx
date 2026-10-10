import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Button, Spinner } from '@librechat/client';
import { MessageSquarePlus, MessagesSquare } from 'lucide-react';
import type { CommentStatus, DesignComment } from '../../api/types';
import type { WorkspaceModeContext } from '../modes/types';
import type { DeviceId } from '../../state/atoms';
import {
  buildCommentChatRequest,
  canChangeCommentStatus,
  commentsForChat,
  selectedByDefault,
} from './comment-request';
import { useFileCommentsQuery, useUpdateCommentMutation } from '../../api/comment-queries';
import { useDesignChatActions, useIsResponding } from '../../chat/DesignChatAdapter';
import { commentDraftAtom, draftFromTarget, isDraftFor } from './comment-draft';
import { DEVICES, deviceAtom, selectedCommentIdAtom } from '../../state/atoms';
import { useFocusWorkspaceTab } from '../workspace-tabs';
import { composerPlacement } from './comment-placement';
import { useFileVersion } from './use-file-version';
import CommentComposer from './CommentComposer';
import { useDesignLocalize } from '../../i18n';
import CommentItem from './CommentItem';
import { cn } from '~/utils';

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

const isPresetDevice = (device: string): device is DeviceId => device in DEVICES;

function useCommentTargets({ project, path, device, bridge }: WorkspaceModeContext) {
  const [, setDraft] = useAtom(commentDraftAtom);
  const projectId = project.projectId;

  useEffect(
    () =>
      bridge.subscribe((message) => {
        if (message.type !== 'etus:target') {
          return;
        }
        setDraft((current) =>
          draftFromTarget(
            message,
            { projectId, path, device },
            isDraftFor(current, { projectId, path }) ? current.body : '',
          ),
        );
      }),
    [bridge, device, path, projectId, setDraft],
  );

  useEffect(() => () => setDraft(null), [setDraft, path, projectId]);
}

function useHighlightSelected(
  comment: DesignComment | undefined,
  { device, bridge }: Pick<WorkspaceModeContext, 'device' | 'bridge'>,
) {
  const selector = comment?.anchor.selector;
  const anchorDevice = comment?.anchor.device;
  const { ready, send } = bridge;
  useEffect(() => {
    if (!selector || !ready) {
      return;
    }
    if (anchorDevice && isPresetDevice(anchorDevice) && anchorDevice !== device) {
      return;
    }
    send({ type: 'etus:highlight', selector });
  }, [anchorDevice, device, ready, selector, send]);
}

export default function CommentPanel(context: WorkspaceModeContext) {
  const { project, me, path, device, geometry } = context;
  const localize = useDesignLocalize();
  const headingId = useId();
  const projectId = project.projectId;
  const responding = useIsResponding();
  const { focus: focusTab } = useFocusWorkspaceTab();
  const { insertIntoComposer } = useDesignChatActions();
  const [draft] = useAtom(commentDraftAtom);
  const [selectedId, setSelectedId] = useAtom(selectedCommentIdAtom);
  const [, setDevice] = useAtom(deviceAtom);
  const [filter, setFilter] = useState<CommentStatus>('open');
  const [chatSelection, setChatSelection] = useState<Record<string, boolean>>({});
  const [sendState, setSendState] = useState<SendState>('idle');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const sending = useRef(false);
  const version = useFileVersion(projectId, path, project.files);
  const query = useFileCommentsQuery({ projectId, path, responding });
  const update = useUpdateCommentMutation(projectId);
  const comments = useMemo(() => query.data ?? [], [query.data]);
  const visible = comments.filter((comment) => comment.status === filter);
  const openCount = comments.filter((comment) => comment.status === 'open').length;
  const resolvedCount = comments.length - openCount;
  const selected = comments.find((comment) => comment.commentId === selectedId);
  const forChat = commentsForChat(comments, chatSelection);
  const numbers = useMemo(
    () => new Map(comments.map((comment, index) => [comment.commentId, index + 1])),
    [comments],
  );

  useCommentTargets(context);
  useHighlightSelected(selected, context);

  const pendingDraft = isDraftFor(draft, { projectId, path }) ? draft : null;
  const anchored =
    pendingDraft != null &&
    pendingDraft.device === device &&
    composerPlacement(pendingDraft.target.rect, geometry) != null;

  const select = (comment: DesignComment) => {
    setSelectedId(comment.commentId);
    if (isPresetDevice(comment.anchor.device) && comment.anchor.device !== device) {
      setDevice(comment.anchor.device);
    }
  };

  const changeStatus = (comment: DesignComment) => {
    setBusyId(comment.commentId);
    setStatusError(false);
    update.mutate(
      { commentId: comment.commentId, status: comment.status === 'open' ? 'resolved' : 'open' },
      {
        onError: () => setStatusError(true),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const sendToChat = async () => {
    if (sending.current || forChat.length === 0 || version == null) {
      return;
    }
    sending.current = true;
    setSendState('sending');
    const text = buildCommentChatRequest({ path, version, comments: forChat, localize });
    const inserted = await insertIntoComposer(text);
    if (!inserted) {
      sending.current = false;
      setSendState('failed');
      return;
    }
    focusTab('chat');
    await Promise.allSettled(
      forChat.map((comment) =>
        update.mutateAsync({ commentId: comment.commentId, sentToChat: true }),
      ),
    );
    setChatSelection((current) => {
      const next = { ...current };
      forChat.forEach((comment) => {
        delete next[comment.commentId];
      });
      return next;
    });
    sending.current = false;
    setSendState('sent');
  };

  let list;
  if (query.isLoading) {
    list = (
      <div role="status" className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="size-4" />
        {localize('comments.loading')}
      </div>
    );
  } else if (query.isError) {
    list = (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-text-secondary">{localize('comments.error')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            query.refetch();
          }}
        >
          {localize('retry')}
        </Button>
      </div>
    );
  } else if (visible.length === 0) {
    list = (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <MessageSquarePlus className="size-6 text-text-secondary" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          {localize(filter === 'open' ? 'comments.empty_open' : 'comments.empty_resolved')}
        </p>
      </div>
    );
  } else {
    list = (
      <ul className="flex flex-col gap-2" aria-labelledby={headingId}>
        {visible.map((comment) => {
          const number = numbers.get(comment.commentId) ?? 0;
          const chatSelectable = project.canWrite && comment.status === 'open';
          return (
            <CommentItem
              key={comment.commentId}
              comment={comment}
              number={number}
              selected={comment.commentId === selectedId}
              canChangeStatus={canChangeCommentStatus(comment, me, project)}
              chatSelectable={chatSelectable}
              chatSelected={chatSelection[comment.commentId] ?? selectedByDefault(comment)}
              busy={busyId === comment.commentId}
              onSelect={() => select(comment)}
              onToggleChat={(checked) =>
                setChatSelection((current) => ({ ...current, [comment.commentId]: checked }))
              }
              onChangeStatus={() => changeStatus(comment)}
            />
          );
        })}
      </ul>
    );
  }

  const filters: { id: CommentStatus; count: number }[] = [
    { id: 'open', count: openCount },
    { id: 'resolved', count: resolvedCount },
  ];

  return (
    <section
      aria-labelledby={headingId}
      data-testid="comment-panel"
      className="flex min-h-full flex-col"
    >
      <div className="flex flex-1 flex-col gap-3 p-3">
        <h2 id={headingId} className="text-sm font-semibold text-text-primary">
          {localize('comments.title')}
        </h2>
        <p className="text-xs text-text-secondary">
          {localize(project.canWrite ? 'comments.hint' : 'comments.hint_read_only')}
        </p>
        {pendingDraft && !anchored ? (
          <CommentComposer project={project} draft={pendingDraft} />
        ) : null}
        <div
          role="group"
          aria-label={localize('comments.filter_label')}
          className="flex rounded-md border border-border-light p-0.5"
        >
          {filters.map(({ id, count }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                'flex-1 rounded px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
                filter === id && 'bg-surface-active text-text-primary',
              )}
            >
              {localize(id === 'open' ? 'comments.filter_open' : 'comments.filter_resolved', {
                count,
              })}
            </button>
          ))}
        </div>
        {statusError ? (
          <p role="alert" className="text-xs text-text-destructive">
            {localize('comments.error_update')}
          </p>
        ) : null}
        {list}
      </div>
      {project.canWrite ? (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border-light bg-presentation p-3">
          <div aria-live="polite" className="text-xs text-text-secondary">
            {sendState === 'sent' ? localize('comments.send_done') : ''}
          </div>
          {sendState === 'failed' ? (
            <p role="alert" className="text-xs text-text-destructive">
              {localize('comments.send_error')}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={forChat.length === 0 || version == null || sendState === 'sending'}
            aria-busy={sendState === 'sending'}
            onClick={() => {
              sendToChat();
            }}
            className="gap-1.5"
          >
            {sendState === 'sending' ? (
              <Spinner className="size-4" />
            ) : (
              <MessagesSquare className="size-4" aria-hidden="true" />
            )}
            {localize('comments.send', { count: forChat.length })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
