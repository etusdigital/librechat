import type * as t from './types';
import { designFetch, designJson, designPath } from './client';
import { designKeys } from './queries';

const PREVIEW_URL_REFRESH_MARGIN_MS = 60_000;

const filesPath = (projectId: string, ...rest: string[]) =>
  designPath('projects', projectId, 'files', ...rest);

export const workspaceKeys = {
  previewUrl: (projectId: string, path: string) =>
    [...designKeys.project(projectId), 'preview-url', path] as const,
  fileContentPrefix: (projectId: string, path: string) =>
    [...designKeys.project(projectId), 'content', path] as const,
};

export const workspaceApi = {
  duplicateProject: (projectId: string, name: string) =>
    designJson<t.DesignProject>(designPath('projects', projectId, 'duplicate'), {
      method: 'POST',
      json: { name },
    }),

  deleteProject: async (projectId: string, confirm: string) => {
    await designFetch(designPath('projects', projectId), { method: 'DELETE', json: { confirm } });
  },

  listChanges: (projectId: string, since?: string, signal?: AbortSignal) =>
    designJson<t.ProjectChanges>(designPath('projects', projectId, 'changes'), {
      query: { since },
      signal,
    }),

  previewUrl: (projectId: string, path: string) =>
    designJson<t.PreviewUrl>(designPath('projects', projectId, 'preview-url'), {
      method: 'POST',
      json: { path },
    }),

  renameFile: (projectId: string, input: { from: string; to: string }) =>
    designJson<t.FileEntry>(filesPath(projectId, 'rename'), { method: 'POST', json: input }),

  deleteFile: async (projectId: string, path: string) => {
    await designFetch(filesPath(projectId, 'content'), { method: 'DELETE', query: { path } });
  },

  uploadFiles: (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    return designJson<{ items: t.FileEntry[] }>(filesPath(projectId, 'upload'), {
      method: 'POST',
      body: form,
    });
  },
};

export function isPreviewUrlFresh(previewUrl: t.PreviewUrl | undefined, now = Date.now()) {
  if (!previewUrl) {
    return false;
  }
  const expiresAt = Date.parse(previewUrl.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now > PREVIEW_URL_REFRESH_MARGIN_MS;
}
