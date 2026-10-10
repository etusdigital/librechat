import type { DesignComment, DesignMe, DesignProject } from '../../api/types';
import type { DesignLocalize } from '../../i18n';

export const CHAT_SNIPPET_MAX = 120;

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function commentRequestLine(comment: DesignComment, index: number) {
  const snippet = clip(oneLine(comment.anchor.textSnippet), CHAT_SNIPPET_MAX);
  const quoted = snippet ? ` "${snippet}"` : '';
  return `${index + 1}. [${comment.anchor.selector}]${quoted}: ${oneLine(comment.body)}`;
}

export function buildCommentChatRequest({
  path,
  version,
  comments,
  localize,
}: {
  path: string;
  version: number;
  comments: DesignComment[];
  localize: DesignLocalize;
}) {
  return [
    localize('comments.chat.intro', { path, version }),
    ...comments.map(commentRequestLine),
    localize('comments.chat.outro'),
  ].join('\n');
}

export function canChangeCommentStatus(
  comment: DesignComment,
  me: Pick<DesignMe, 'sub'>,
  project: Pick<DesignProject, 'canWrite'>,
) {
  return project.canWrite || comment.authorSub === me.sub;
}

export function selectedByDefault(comment: DesignComment) {
  return comment.status === 'open' && !comment.sentToChatAt;
}

export function commentsForChat(
  comments: DesignComment[],
  selection: Record<string, boolean>,
): DesignComment[] {
  return comments.filter(
    (comment) =>
      comment.status === 'open' && (selection[comment.commentId] ?? selectedByDefault(comment)),
  );
}
