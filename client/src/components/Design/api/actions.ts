import type * as t from './types';
import { designApi, designJson, designPath } from './client';

export type ExportFormat = 'html' | 'zip' | 'md' | 'pdf' | 'pptx' | 'png';
export type PdfMode = 'vector' | 'raster';
export type PptxMode = 'image' | 'editable';
export type ExportDevice = 'mobile' | 'tablet' | 'desktop';

export interface ExportRequest {
  format: ExportFormat;
  path?: string;
  options?: { pdfMode?: PdfMode; pptxMode?: PptxMode; device?: ExportDevice };
}

export type CreateShareInput =
  | { kind: 'company'; expiresInDays?: number }
  | { kind: 'public'; expiresInDays?: number }
  | { kind: 'people'; authUserIds: string[]; expiresInDays?: number };

export const designActionsApi = {
  restoreVersion: (projectId: string, input: { path: string; version: number }) =>
    designApi.restoreVersion(projectId, input),

  exportProject: (projectId: string, input: ExportRequest) =>
    designJson<t.DesignJob>(designPath('projects', projectId, 'exports'), {
      method: 'POST',
      json: input,
    }),

  createShare: (projectId: string, input: CreateShareInput) =>
    designJson<t.DesignShare>(designPath('projects', projectId, 'shares'), {
      method: 'POST',
      json: input,
    }),

  revokeShare: (shareId: string) =>
    designJson<void>(designPath('shares', shareId), { method: 'DELETE' }),

  versionPreviewUrl: (projectId: string, input: { path: string; version: number }) =>
    designApi.previewUrl(projectId, input),

  readVersionText: async (
    projectId: string,
    input: { path: string; version: number },
    signal?: AbortSignal,
  ) => {
    const content = await designApi.readFile(projectId, input, signal);
    return content.blob.text();
  },
};
