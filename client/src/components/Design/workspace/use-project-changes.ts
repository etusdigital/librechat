import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FileEntry, ProjectChanges } from '../api/types';
import { workspaceApi, workspaceKeys } from '../api/workspace';
import { designKeys } from '../api/queries';

export const CHANGES_POLL_RESPONDING_MS = 3_000;
export const CHANGES_POLL_IDLE_MS = 20_000;

export interface ChangeSet {
  changed: string[];
  removed: string[];
}

export interface ProjectChangesState {
  revision: number;
  lastChange: ChangeSet | null;
}

export function diffChanges(known: Map<string, string>, changes: ProjectChanges): ChangeSet {
  const current = new Set(changes.paths);
  const changed = changes.items
    .filter((item: FileEntry) => current.has(item.path) && known.get(item.path) !== item.sha256)
    .map((item) => item.path);
  const removed = [...known.keys()].filter((path) => !current.has(path));
  return { changed, removed };
}

export function applyChanges(known: Map<string, string>, changes: ProjectChanges) {
  const next = new Map<string, string>();
  const current = new Set(changes.paths);
  known.forEach((sha, path) => {
    if (current.has(path)) {
      next.set(path, sha);
    }
  });
  changes.items.forEach((item) => {
    if (current.has(item.path)) {
      next.set(item.path, item.sha256);
    }
  });
  return next;
}

export function pollDelay(responding: boolean) {
  return responding ? CHANGES_POLL_RESPONDING_MS : CHANGES_POLL_IDLE_MS;
}

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useProjectChanges({
  projectId,
  responding,
  onChange,
}: {
  projectId: string;
  responding: boolean;
  onChange?: (changes: ChangeSet) => void;
}): ProjectChangesState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ProjectChangesState>({ revision: 0, lastChange: null });
  const known = useRef<Map<string, string> | null>(null);
  const since = useRef<string | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  const respondingRef = useRef(responding);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const pollRef = useRef<() => void>(() => undefined);
  onChangeRef.current = onChange;
  respondingRef.current = responding;

  const schedule = useCallback((delay: number) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => pollRef.current(), delay);
  }, []);

  const handle = useCallback(
    (changes: ProjectChanges) => {
      since.current = changes.until;
      if (!known.current) {
        known.current = applyChanges(new Map(), changes);
        return;
      }
      const diff = diffChanges(known.current, changes);
      known.current = applyChanges(known.current, changes);
      if (diff.changed.length === 0 && diff.removed.length === 0) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: designKeys.project(projectId), exact: true });
      queryClient.invalidateQueries({ queryKey: designKeys.files(projectId) });
      [...diff.changed, ...diff.removed].forEach((path) => {
        queryClient.invalidateQueries({
          queryKey: workspaceKeys.fileContentPrefix(projectId, path),
        });
        queryClient.invalidateQueries({ queryKey: designKeys.versions(projectId, path) });
      });
      setState((current) => ({ revision: current.revision + 1, lastChange: diff }));
      onChangeRef.current?.(diff);
    },
    [projectId, queryClient],
  );

  pollRef.current = () => {
    timer.current = null;
    if (isHidden()) {
      return;
    }
    const controller = new AbortController();
    inFlight.current?.abort();
    inFlight.current = controller;
    Promise.resolve()
      .then(() => workspaceApi.listChanges(projectId, since.current, controller.signal))
      .then((changes) => {
        if (!controller.signal.aborted) {
          handle(changes);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (inFlight.current === controller) {
          inFlight.current = null;
          schedule(pollDelay(respondingRef.current));
        }
      });
  };

  useEffect(() => {
    known.current = null;
    since.current = undefined;
    setState({ revision: 0, lastChange: null });
    pollRef.current();
    const onVisibility = () => {
      if (!isHidden() && !timer.current && !inFlight.current) {
        pollRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [projectId]);

  const wasResponding = useRef(responding);
  useEffect(() => {
    if (wasResponding.current === responding) {
      return;
    }
    wasResponding.current = responding;
    if (!inFlight.current) {
      schedule(responding ? CHANGES_POLL_RESPONDING_MS : 0);
    }
  }, [responding, schedule]);

  return state;
}
