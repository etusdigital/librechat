import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DesignProject, DesignSystemSummary } from './types';
import { designKeys, retryDesignQuery, useDesignSystemsQuery } from './queries';
import { designApi } from './client';

const THUMBNAIL_STALE_MS = 10 * 60 * 1000;

export const homeKeys = {
  thumbnail: (project: Pick<DesignProject, 'projectId' | 'entryFile' | 'updatedAt'>) =>
    [
      ...designKeys.project(project.projectId),
      'thumbnail',
      project.entryFile,
      project.updatedAt ?? '',
    ] as const,
};

export function useProjectThumbnailQuery(
  project: Pick<DesignProject, 'projectId' | 'entryFile' | 'updatedAt'>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: homeKeys.thumbnail(project),
    queryFn: async () => (await designApi.previewUrl(project.projectId, {})).url,
    staleTime: THUMBNAIL_STALE_MS,
    cacheTime: THUMBNAIL_STALE_MS,
    refetchOnWindowFocus: false,
    retry: retryDesignQuery,
    enabled,
  });
}

export function useDesignSystemDirectory(enabled = true) {
  const query = useDesignSystemsQuery({}, { enabled });
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = query;

  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage && !isError) {
      fetchNextPage();
    }
  }, [enabled, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  return useMemo(() => {
    const directory = new Map<string, DesignSystemSummary>();
    for (const page of query.data?.pages ?? []) {
      for (const system of page.items) {
        directory.set(system.id, system);
      }
    }
    return directory;
  }, [query.data?.pages]);
}
