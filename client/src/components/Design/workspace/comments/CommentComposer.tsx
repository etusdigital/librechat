import { useEffect, useId, useRef } from 'react';
import { useSetAtom } from 'jotai';
import { Button, Spinner } from '@librechat/client';
import type { CSSProperties } from 'react';
import type { DesignProjectDetail } from '../../api/types';
import type { CommentDraft } from './comment-draft';
import { useCreateCommentMutation } from '../../api/comment-queries';
import { selectedCommentIdAtom } from '../../state/atoms';
import { useFileVersion } from './use-file-version';
import { designErrorCode } from '../../api/errors';
import { commentDraftAtom } from './comment-draft';
import { useDesignLocalize } from '../../i18n';
import { cn } from '~/utils';

export const COMMENT_BODY_MAX = 4000;

export default function CommentComposer({
  project,
  draft,
  className,
  style,
}: {
  project: DesignProjectDetail;
  draft: CommentDraft;
  className?: string;
  style?: CSSProperties;
}) {
  const localize = useDesignLocalize();
  const fieldId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const setDraft = useSetAtom(commentDraftAtom);
  const setSelected = useSetAtom(selectedCommentIdAtom);
  const version = useFileVersion(project.projectId, draft.path, project.files);
  const create = useCreateCommentMutation(project.projectId);
  const body = draft.body.trim();
  const target = draft.target.textSnippet.trim() || draft.target.tag;

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, [draft.target.selector]);

  const cancel = () => setDraft(null);

  const save = () => {
    if (!body || version == null || create.isLoading) {
      return;
    }
    create.mutate(
      {
        path: draft.path,
        version,
        body,
        anchor: {
          selector: draft.target.selector,
          textSnippet: draft.target.textSnippet,
          rect: draft.target.rect,
          device: draft.device,
        },
      },
      {
        onSuccess: (comment) => {
          setDraft(null);
          setSelected(comment.commentId);
        },
      },
    );
  };

  const errorKey =
    designErrorCode(create.error) === 'version_not_found'
      ? 'comments.error_version'
      : 'comments.error_create';

  return (
    <form
      data-testid="comment-composer"
      aria-label={localize('comments.composer_title')}
      style={style}
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border-medium bg-surface-primary p-3 text-text-primary shadow-lg',
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <label htmlFor={fieldId} className="text-xs font-medium text-text-secondary">
        <span className="block">{localize('comments.composer_title')}</span>
        <span className="block truncate font-normal" title={draft.target.selector}>
          {localize('comments.composer_target', { target })}
        </span>
      </label>
      <textarea
        ref={textareaRef}
        id={fieldId}
        value={draft.body}
        rows={3}
        maxLength={COMMENT_BODY_MAX}
        placeholder={localize('comments.composer_placeholder')}
        disabled={create.isLoading}
        onChange={(event) => {
          const next = event.target.value;
          setDraft((current) => (current ? { ...current, body: next } : current));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
        className="w-full resize-none rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:opacity-50"
      />
      {create.isError ? (
        <p role="alert" className="text-xs text-text-destructive">
          {localize(errorKey)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={cancel}>
          {localize('comments.composer_cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!body || version == null || create.isLoading}
          aria-busy={create.isLoading}
        >
          {create.isLoading ? <Spinner className="size-4" /> : null}
          {localize('comments.composer_save')}
        </Button>
      </div>
    </form>
  );
}
