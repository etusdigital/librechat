import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isDesignApiError, isRetryableDesignError } from '../api/errors';
import { designApi } from '../api/client';

const STORAGE_PREFIX = 'etus-design:conversation:';
const MAX_BIND_RETRIES = 2;

const storageKey = (projectId: string) => `${STORAGE_PREFIX}${projectId}`;

export function readStoredConversation(projectId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(projectId));
  } catch {
    return null;
  }
}

export function storeConversation(projectId: string, conversationId: string) {
  try {
    window.localStorage.setItem(storageKey(projectId), conversationId);
  } catch {
    return;
  }
}

export function forgetConversation(projectId: string) {
  try {
    window.localStorage.removeItem(storageKey(projectId));
  } catch {
    return;
  }
}

export interface ResolvedConversation {
  conversationId: string | null;
  needsBinding: boolean;
}

export type ConversationResolution =
  | { status: 'resolving' }
  | ({ status: 'ready' } & ResolvedConversation);

type ProjectOfConversation = (
  conversationId: string,
  signal?: AbortSignal,
) => Promise<{ projectId: string }>;

export async function resolveProjectConversation(
  projectId: string,
  stored: string | null,
  projectOf: ProjectOfConversation,
  signal?: AbortSignal,
): Promise<ResolvedConversation> {
  if (!stored) {
    return { conversationId: null, needsBinding: false };
  }
  try {
    const bound = await projectOf(stored, signal);
    if (bound.projectId === projectId) {
      return { conversationId: stored, needsBinding: false };
    }
    forgetConversation(projectId);
    return { conversationId: null, needsBinding: false };
  } catch (error) {
    if (isDesignApiError(error) && error.status === 404) {
      return { conversationId: stored, needsBinding: true };
    }
    return { conversationId: stored, needsBinding: false };
  }
}

export function useProjectConversation(projectId: string): ConversationResolution {
  const [resolution, setResolution] = useState<ConversationResolution>({ status: 'resolving' });

  useEffect(() => {
    const controller = new AbortController();
    setResolution({ status: 'resolving' });
    resolveProjectConversation(
      projectId,
      readStoredConversation(projectId),
      designApi.projectOfConversation,
      controller.signal,
    ).then((resolved) => {
      if (!controller.signal.aborted) {
        setResolution({ status: 'ready', ...resolved });
      }
    });
    return () => controller.abort();
  }, [projectId]);

  return resolution;
}

export function useBindProjectConversation(projectId: string) {
  const { mutate } = useMutation({
    mutationFn: (conversationId: string) => designApi.bindConversation(projectId, conversationId),
    retry: (failureCount, error) =>
      failureCount < MAX_BIND_RETRIES && isRetryableDesignError(error),
  });
  return useCallback(
    (conversationId: string) => {
      storeConversation(projectId, conversationId);
      mutate(conversationId);
    },
    [mutate, projectId],
  );
}
