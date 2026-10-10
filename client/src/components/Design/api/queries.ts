import { useMutation, useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type * as t from './types';
import { isRetryableDesignError } from './errors';
import { designApi } from './client';

const ROOT = 'etus-design';
const PAGE_LIMIT = 48;
const MAX_RETRIES = 2;
const JOB_POLL_MS = 2000;

export const designKeys = {
  all: [ROOT] as const,
  me: () => [ROOT, 'me'] as const,
  projects: (scope: t.ProjectScope, query: string) => [ROOT, 'projects', scope, query] as const,
  project: (projectId: string) => [ROOT, 'project', projectId] as const,
  files: (projectId: string) => [ROOT, 'project', projectId, 'files'] as const,
  fileContent: (projectId: string, path: string, version?: number) =>
    [ROOT, 'project', projectId, 'content', path, version ?? 'latest'] as const,
  versions: (projectId: string, path: string) =>
    [ROOT, 'project', projectId, 'versions', path] as const,
  comments: (projectId: string, path?: string, status?: t.CommentStatus) =>
    [ROOT, 'project', projectId, 'comments', path ?? '', status ?? ''] as const,
  shares: (projectId: string) => [ROOT, 'project', projectId, 'shares'] as const,
  job: (jobId: string) => [ROOT, 'job', jobId] as const,
  templates: (kind?: t.TemplateKind) => [ROOT, 'templates', kind ?? 'all'] as const,
  designSystems: (query: string, category: string) =>
    [ROOT, 'design-systems', query, category] as const,
  designSystem: (systemId: string) => [ROOT, 'design-system', systemId] as const,
};

export function retryDesignQuery(failureCount: number, error: unknown) {
  return failureCount < MAX_RETRIES && isRetryableDesignError(error);
}

const baseOptions = { retry: retryDesignQuery, refetchOnWindowFocus: false } as const;

export function useDesignMeQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.me(),
    queryFn: ({ signal }) => designApi.me(signal),
    staleTime: 5 * 60 * 1000,
    ...baseOptions,
    ...options,
  });
}

export function useDesignProjectsQuery(
  { scope = 'mine', query = '' }: { scope?: t.ProjectScope; query?: string } = {},
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: designKeys.projects(scope, query),
    queryFn: ({ pageParam, signal }) =>
      designApi.listProjects(
        { scope, query: query || undefined, limit: PAGE_LIMIT, cursor: pageParam ?? null },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    ...baseOptions,
    ...options,
  });
}

export function useDesignProjectQuery(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.project(projectId),
    queryFn: ({ signal }) => designApi.getProject(projectId, signal),
    ...baseOptions,
    ...options,
    enabled: Boolean(projectId) && options?.enabled !== false,
  });
}

export function useDesignFilesQuery(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.files(projectId),
    queryFn: async ({ signal }) => (await designApi.listFiles(projectId, undefined, signal)).items,
    ...baseOptions,
    ...options,
  });
}

export function useDesignFileContentQuery(
  { projectId, path, version }: { projectId: string; path: string; version?: number },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: designKeys.fileContent(projectId, path, version),
    queryFn: ({ signal }) => designApi.readFile(projectId, { path, version }, signal),
    staleTime: version ? Infinity : 0,
    ...baseOptions,
    ...options,
  });
}

export function useDesignVersionsQuery(
  { projectId, path }: { projectId: string; path: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: designKeys.versions(projectId, path),
    queryFn: async ({ signal }) => (await designApi.listVersions(projectId, path, signal)).items,
    ...baseOptions,
    ...options,
  });
}

export function useDesignCommentsQuery(
  { projectId, path, status }: { projectId: string; path?: string; status?: t.CommentStatus },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: designKeys.comments(projectId, path, status),
    queryFn: ({ signal }) => designApi.listComments(projectId, { path, status }, signal),
    ...baseOptions,
    ...options,
  });
}

export function useDesignSharesQuery(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.shares(projectId),
    queryFn: ({ signal }) => designApi.listShares(projectId, signal),
    ...baseOptions,
    ...options,
  });
}

export function isJobFinished(job: t.DesignJob | undefined) {
  return job?.status === 'succeeded' || job?.status === 'failed';
}

export function useDesignJobQuery(jobId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.job(jobId ?? ''),
    queryFn: ({ signal }) => designApi.getJob(jobId ?? '', signal),
    refetchInterval: (job) => (isJobFinished(job) ? false : JOB_POLL_MS),
    ...baseOptions,
    ...options,
    enabled: Boolean(jobId) && options?.enabled !== false,
  });
}

export function useDesignTemplatesQuery(kind?: t.TemplateKind, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.templates(kind),
    queryFn: async ({ signal }) => (await designApi.listTemplates(kind, signal)).items,
    staleTime: 10 * 60 * 1000,
    ...baseOptions,
    ...options,
  });
}

export function useDesignSystemsQuery(
  { query = '', category = '' }: { query?: string; category?: string } = {},
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey: designKeys.designSystems(query, category),
    queryFn: ({ pageParam, signal }) =>
      designApi.listDesignSystems(
        {
          query: query || undefined,
          category: category || undefined,
          limit: PAGE_LIMIT,
          cursor: pageParam ?? null,
        },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10 * 60 * 1000,
    ...baseOptions,
    ...options,
  });
}

export function useDesignSystemQuery(systemId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: designKeys.designSystem(systemId),
    queryFn: ({ signal }) => designApi.getDesignSystem(systemId, signal),
    staleTime: 10 * 60 * 1000,
    ...baseOptions,
    ...options,
    enabled: Boolean(systemId) && options?.enabled !== false,
  });
}

export function useCreateDesignProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: designApi.createProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [ROOT, 'projects'] }),
  });
}

export function useUpdateDesignProjectMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof designApi.updateProject>[1]) =>
      designApi.updateProject(projectId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: [ROOT, 'projects'] });
    },
  });
}

export function useSetCompanyDefaultDesignSystemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: designApi.setCompanyDefaultDesignSystem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: designKeys.me() }),
  });
}
