import { useCallback } from 'react';
import { atomFamily } from 'jotai/utils';
import { atom, useAtomValue, useStore } from 'jotai';

export const pendingBriefAtomFamily = atomFamily((_projectId: string) => atom<string | null>(null));

export function useSetPendingBrief() {
  const store = useStore();
  return useCallback(
    (projectId: string, brief: string) => {
      const text = brief.trim();
      store.set(pendingBriefAtomFamily(projectId), text ? text : null);
    },
    [store],
  );
}

export interface PendingBrief {
  brief: string | null;
  consume: () => string | null;
}

export function usePendingBrief(projectId: string): PendingBrief {
  const store = useStore();
  const brief = useAtomValue(pendingBriefAtomFamily(projectId), { store });
  const consume = useCallback(() => {
    const current = store.get(pendingBriefAtomFamily(projectId));
    store.set(pendingBriefAtomFamily(projectId), null);
    pendingBriefAtomFamily.remove(projectId);
    return current;
  }, [projectId, store]);
  return { brief, consume };
}
