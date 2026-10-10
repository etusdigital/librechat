import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceApi, workspaceKeys } from './workspace';
import { designKeys, retryDesignQuery } from './queries';

export function usePreviewUrlQuery(
  { projectId, path }: { projectId: string; path: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: workspaceKeys.previewUrl(projectId, path),
    queryFn: () => workspaceApi.previewUrl(projectId, path),
    staleTime: Infinity,
    retry: retryDesignQuery,
    refetchOnWindowFocus: false,
    ...options,
    enabled: Boolean(projectId && path) && options?.enabled !== false,
  });
}

function useInvalidateFiles(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: designKeys.project(projectId), exact: true });
    queryClient.invalidateQueries({ queryKey: designKeys.files(projectId) });
  };
}

export function useRenameFileMutation(projectId: string) {
  const invalidate = useInvalidateFiles(projectId);
  return useMutation({
    mutationFn: (input: { from: string; to: string }) => workspaceApi.renameFile(projectId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteFileMutation(projectId: string) {
  const invalidate = useInvalidateFiles(projectId);
  return useMutation({
    mutationFn: (path: string) => workspaceApi.deleteFile(projectId, path),
    onSuccess: invalidate,
  });
}

export function useUploadFilesMutation(projectId: string) {
  const invalidate = useInvalidateFiles(projectId);
  return useMutation({
    mutationFn: (files: File[]) => workspaceApi.uploadFiles(projectId, files),
    onSuccess: invalidate,
  });
}

export function useDuplicateProjectMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => workspaceApi.duplicateProject(projectId, name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...designKeys.all, 'projects'] }),
  });
}

export function useDeleteProjectMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (confirm: string) => workspaceApi.deleteProject(projectId, confirm),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: designKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: [...designKeys.all, 'projects'] });
    },
  });
}
