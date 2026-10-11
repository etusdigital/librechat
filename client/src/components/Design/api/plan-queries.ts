import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { retryDesignQuery } from './queries';
import { planApi, planKeys } from './plan';

export const PLAN_POLL_RESPONDING_MS = 3_000;
export const PLAN_POLL_IDLE_MS = 20_000;

export function usePlanQuery(projectId: string, { responding }: { responding: boolean }) {
  const query = useQuery({
    queryKey: planKeys.plan(projectId),
    queryFn: async ({ signal }) => (await planApi.get(projectId, signal)).plan,
    refetchInterval: responding ? PLAN_POLL_RESPONDING_MS : PLAN_POLL_IDLE_MS,
    refetchIntervalInBackground: false,
    retry: retryDesignQuery,
    refetchOnWindowFocus: false,
    enabled: Boolean(projectId),
  });
  const wasResponding = useRef(responding);
  const { refetch } = query;

  useEffect(() => {
    if (wasResponding.current && !responding) {
      refetch();
    }
    wasResponding.current = responding;
  }, [responding, refetch]);

  return query;
}
