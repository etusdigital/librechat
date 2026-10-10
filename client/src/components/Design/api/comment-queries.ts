import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { CreateCommentInput, UpdateCommentInput } from './comments';
import type { DesignComment } from './types';
import { designKeys, retryDesignQuery } from './queries';
import { commentKeys, commentsApi } from './comments';
import { designApi } from './client';

export const COMMENTS_POLL_RESPONDING_MS = 3000;
export const COMMENTS_POLL_IDLE_MS = 20_000;

export function useFileCommentsQuery({
  projectId,
  path,
  responding,
}: {
  projectId: string;
  path: string;
  responding: boolean;
}) {
  return useQuery({
    queryKey: designKeys.comments(projectId, path),
    queryFn: ({ signal }) => designApi.listComments(projectId, { path }, signal),
    retry: retryDesignQuery,
    refetchOnWindowFocus: false,
    refetchInterval: responding ? COMMENTS_POLL_RESPONDING_MS : COMMENTS_POLL_IDLE_MS,
    enabled: Boolean(projectId && path),
  });
}

function keyMatches(key: QueryKey, comment: DesignComment) {
  const [, , , , path, status] = key;
  return (path === '' || path === comment.path) && (status === '' || status === comment.status);
}

export function mergeComment(list: DesignComment[], comment: DesignComment) {
  const exists = list.some((item) => item.commentId === comment.commentId);
  return exists
    ? list.map((item) => (item.commentId === comment.commentId ? comment : item))
    : [...list, comment];
}

function storeComment(queryClient: QueryClient, projectId: string, comment: DesignComment) {
  queryClient.getQueriesData<DesignComment[]>(commentKeys.all(projectId)).forEach(([key, list]) => {
    if (!Array.isArray(list)) {
      return;
    }
    if (keyMatches(key, comment)) {
      queryClient.setQueryData(key, mergeComment(list, comment));
    } else if (list.some((item) => item.commentId === comment.commentId)) {
      queryClient.setQueryData(
        key,
        list.filter((item) => item.commentId !== comment.commentId),
      );
    }
  });
}

export function useCreateCommentMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) => commentsApi.create(projectId, input),
    onSuccess: (comment) => storeComment(queryClient, projectId, comment),
  });
}

export function useUpdateCommentMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, ...input }: UpdateCommentInput & { commentId: string }) =>
      commentsApi.update(commentId, input),
    onSuccess: (comment) => storeComment(queryClient, projectId, comment),
  });
}
