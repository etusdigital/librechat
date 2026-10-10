import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateShareInput, ExportRequest } from './actions';
import { designKeys, retryDesignQuery } from './queries';
import { designActionsApi } from './actions';

const PREVIEW_STALE_MS = 60 * 1000;

export const designActionKeys = {
  versionPreview: (projectId: string, path: string, version: number) =>
    [...designKeys.project(projectId), 'version-preview', path, version] as const,
  versionText: (projectId: string, path: string, version: number) =>
    [...designKeys.project(projectId), 'version-text', path, version] as const,
};

const baseOptions = { retry: retryDesignQuery, refetchOnWindowFocus: false } as const;

export function useVersionPreviewQuery(
  { projectId, path, version }: { projectId: string; path: string; version: number | null },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: designActionKeys.versionPreview(projectId, path, version ?? 0),
    queryFn: () => designActionsApi.versionPreviewUrl(projectId, { path, version: version ?? 0 }),
    staleTime: PREVIEW_STALE_MS,
    ...baseOptions,
    ...options,
    enabled: version !== null && options?.enabled !== false,
  });
}

export function useVersionTextQuery(
  { projectId, path, version }: { projectId: string; path: string; version: number | null },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: designActionKeys.versionText(projectId, path, version ?? 0),
    queryFn: ({ signal }) =>
      designActionsApi.readVersionText(projectId, { path, version: version ?? 0 }, signal),
    staleTime: Infinity,
    ...baseOptions,
    ...options,
    enabled: version !== null && options?.enabled !== false,
  });
}

export function useRestoreVersionMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; version: number }) =>
      designActionsApi.restoreVersion(projectId, input),
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: designKeys.versions(projectId, input.path) });
      queryClient.invalidateQueries({ queryKey: designKeys.files(projectId) });
      queryClient.invalidateQueries({ queryKey: designKeys.project(projectId), exact: true });
      queryClient.invalidateQueries({
        queryKey: [...designKeys.project(projectId), 'content', input.path],
      });
    },
  });
}

export function useExportProjectMutation(projectId: string) {
  return useMutation({
    mutationFn: (input: ExportRequest) => designActionsApi.exportProject(projectId, input),
  });
}

export function useCreateShareMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareInput) => designActionsApi.createShare(projectId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: designKeys.shares(projectId) }),
  });
}

export function useRevokeSharesMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shareIds: string[]) => {
      for (const shareId of shareIds) {
        await designActionsApi.revokeShare(shareId);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: designKeys.shares(projectId) }),
  });
}
