import { atom } from 'jotai';
import type { FrameMessage } from '../../preview/host-protocol';
import type { DeviceId } from '../../state/atoms';

type FrameTarget = Extract<FrameMessage, { type: 'etus:target' }>;

export type CommentTarget = Pick<FrameTarget, 'selector' | 'textSnippet' | 'rect' | 'tag'>;

export interface CommentDraft {
  projectId: string;
  path: string;
  device: DeviceId;
  target: CommentTarget;
  body: string;
}

export const commentDraftAtom = atom<CommentDraft | null>(null);

export function draftFromTarget(
  message: FrameTarget,
  scope: { projectId: string; path: string; device: DeviceId },
  body = '',
): CommentDraft {
  const { selector, textSnippet, rect, tag } = message;
  return { ...scope, target: { selector, textSnippet, rect, tag }, body };
}

export function isDraftFor(
  draft: CommentDraft | null,
  scope: { projectId: string; path: string },
): draft is CommentDraft {
  return Boolean(draft && draft.projectId === scope.projectId && draft.path === scope.path);
}
