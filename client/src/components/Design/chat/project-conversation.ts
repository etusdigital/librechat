import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ProjectConversation } from '../api/types';
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

export interface ConversationLookup {
  projectOf: (conversationId: string, signal?: AbortSignal) => Promise<{ projectId: string }>;
  listConversations: (
    projectId: string,
    signal?: AbortSignal,
  ) => Promise<{ items: ProjectConversation[] }>;
}

type StoredState = 'bound' | 'elsewhere' | 'unbound' | 'unknown';

async function storedStateOf(
  projectId: string,
  stored: string,
  lookup: ConversationLookup,
  signal?: AbortSignal,
): Promise<StoredState> {
  try {
    const bound = await lookup.projectOf(stored, signal);
    return bound.projectId === projectId ? 'bound' : 'elsewhere';
  } catch (error) {
    return isDesignApiError(error) && error.status === 404 ? 'unbound' : 'unknown';
  }
}

async function latestBoundConversation(
  projectId: string,
  lookup: ConversationLookup,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await lookup.listConversations(projectId, signal);
    const latest = response?.items?.[0]?.conversationId;
    return typeof latest === 'string' && latest.length > 0 ? latest : null;
  } catch {
    return null;
  }
}

export async function resolveProjectConversation(
  projectId: string,
  stored: string | null,
  lookup: ConversationLookup,
  signal?: AbortSignal,
): Promise<ResolvedConversation> {
  const state = stored ? await storedStateOf(projectId, stored, lookup, signal) : null;
  if (stored && state && state !== 'elsewhere') {
    return { conversationId: stored, needsBinding: state === 'unbound' };
  }
  if (state === 'elsewhere') {
    forgetConversation(projectId);
  }
  const latest = await latestBoundConversation(projectId, lookup, signal);
  if (latest) {
    storeConversation(projectId, latest);
    return { conversationId: latest, needsBinding: false };
  }
  return { conversationId: null, needsBinding: false };
}

const serviceLookup: ConversationLookup = {
  projectOf: (conversationId, signal) => designApi.projectOfConversation(conversationId, signal),
  listConversations: (projectId, signal) => designApi.listProjectConversations(projectId, signal),
};

export function useProjectConversation(projectId: string): ConversationResolution {
  const [resolution, setResolution] = useState<ConversationResolution>({ status: 'resolving' });

  useEffect(() => {
    const controller = new AbortController();
    setResolution({ status: 'resolving' });
    resolveProjectConversation(
      projectId,
      readStoredConversation(projectId),
      serviceLookup,
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
