import type * as t from './types';
import { designJson, designPath } from './client';
import { designKeys } from './queries';

export interface CreateCommentInput {
  path: string;
  version: number;
  anchor: t.CommentAnchor;
  body: string;
}

export interface UpdateCommentInput {
  status?: t.CommentStatus;
  sentToChat?: boolean;
}

export const commentKeys = {
  all: (projectId: string) => [...designKeys.project(projectId), 'comments'] as const,
};

export const commentsApi = {
  create: (projectId: string, input: CreateCommentInput) =>
    designJson<t.DesignComment>(designPath('projects', projectId, 'comments'), {
      method: 'POST',
      json: input,
    }),

  update: (commentId: string, input: UpdateCommentInput) =>
    designJson<t.DesignComment>(designPath('comments', commentId), {
      method: 'PATCH',
      json: input,
    }),
};
