import { apiBaseUrl, request } from 'librechat-data-provider';
import type * as t from './types';
import { DesignApiError } from './errors';

export const DESIGN_API_PATH = '/api/etus/design';

export type DesignQueryValue = string | number | boolean | null | undefined;
export type DesignQuery = Record<string, DesignQueryValue>;

export interface DesignRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: DesignQuery;
  json?: unknown;
  body?: Blob | ArrayBuffer | string | FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function designPath(...segments: string[]) {
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

export function designUrl(path: string, query?: DesignQuery) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  const suffix = encoded ? `?${encoded}` : '';
  return `${apiBaseUrl()}${DESIGN_API_PATH}/${path.replace(/^\/+/, '')}${suffix}`;
}

function retryAfterOf(response: Response) {
  const raw = response.headers.get('Retry-After');
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function errorDetailsOf(body: Record<string, unknown>) {
  const { code: _code, message: _message, details, ...rest } = body;
  const merged = { ...rest, ...(isRecord(details) ? details : {}) };
  return Object.keys(merged).length > 0 ? merged : null;
}

export async function errorOf(response: Response) {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const error = isRecord(payload) ? payload.error : null;
  const body = isRecord(error) ? error : {};
  return new DesignApiError({
    status: response.status,
    code: typeof body.code === 'string' ? body.code : `http_${response.status}`,
    message: typeof body.message === 'string' ? body.message : undefined,
    details: errorDetailsOf(body),
    retryAfterSeconds: retryAfterOf(response),
  });
}

export async function designFetch(path: string, options: DesignRequestOptions = {}) {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined = options.body;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const response = await request.authenticatedFetch(designUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
  });
  if (!response.ok) {
    throw await errorOf(response);
  }
  return response;
}

export async function designJson<T>(path: string, options?: DesignRequestOptions): Promise<T> {
  const response = await designFetch(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const projectPath = (projectId: string, ...rest: string[]) =>
  designPath('projects', projectId, ...rest);

export const designApi = {
  me: (signal?: AbortSignal) => designJson<t.DesignMe>('me', { signal }),

  listProjects: (
    params: { scope?: t.ProjectScope; query?: string; limit?: number; cursor?: string | null },
    signal?: AbortSignal,
  ) => designJson<t.Page<t.DesignProject>>('projects', { query: params, signal }),

  getProject: (projectId: string, signal?: AbortSignal) =>
    designJson<t.DesignProjectDetail>(projectPath(projectId), { signal }),

  createProject: (input: {
    name: string;
    kind: t.ProjectKind;
    designSystemId?: string;
    templateId?: string;
  }) => designJson<t.DesignProject>('projects', { method: 'POST', json: input }),

  updateProject: (
    projectId: string,
    patch: { name?: string; designSystemId?: string; entryFile?: string; tags?: string[] },
  ) => designJson<t.DesignProject>(projectPath(projectId), { method: 'PATCH', json: patch }),

  bindConversation: (projectId: string, conversationId: string) =>
    designJson<void>(projectPath(projectId, 'conversations'), {
      method: 'POST',
      json: { conversationId },
    }),

  listProjectConversations: (projectId: string, signal?: AbortSignal) =>
    designJson<{ items: t.ProjectConversation[] }>(projectPath(projectId, 'conversations'), {
      signal,
    }),

  projectOfConversation: (conversationId: string, signal?: AbortSignal) =>
    designJson<t.DesignProject>(designPath('conversations', conversationId, 'project'), {
      signal,
    }),

  listFiles: (projectId: string, since?: string, signal?: AbortSignal) =>
    designJson<{ items: t.FileEntry[] }>(projectPath(projectId, 'files'), {
      query: { since },
      signal,
    }),

  listChanges: (projectId: string, since?: string, signal?: AbortSignal) =>
    designJson<t.ProjectChanges>(projectPath(projectId, 'changes'), { query: { since }, signal }),

  readFile: async (
    projectId: string,
    params: { path: string; version?: number },
    signal?: AbortSignal,
  ): Promise<t.FileContent> => {
    const response = await designFetch(projectPath(projectId, 'files', 'content'), {
      query: params,
      headers: { Accept: '*/*' },
      signal,
    });
    const version = Number(response.headers.get('X-Etus-Version'));
    return {
      blob: await response.blob(),
      mime: response.headers.get('X-Etus-Mime') ?? response.headers.get('Content-Type') ?? '',
      etag: response.headers.get('ETag'),
      version: Number.isInteger(version) && version > 0 ? version : null,
    };
  },

  writeFile: (
    projectId: string,
    params: {
      path: string;
      content: Blob | string;
      contentType?: string;
      ifMatch?: string;
      versionSource?: t.VersionSource;
      note?: string;
    },
  ) => {
    const headers: Record<string, string> = {
      'Content-Type':
        params.contentType ||
        (typeof params.content === 'string' ? 'text/plain; charset=utf-8' : params.content.type) ||
        'application/octet-stream',
    };
    if (params.ifMatch) {
      headers['If-Match'] = params.ifMatch;
    }
    if (params.versionSource) {
      headers['X-Etus-Version-Source'] = params.versionSource;
    }
    if (params.note) {
      headers['X-Etus-Note'] = encodeURIComponent(params.note);
    }
    return designJson<t.FileWriteResult>(projectPath(projectId, 'files', 'content'), {
      method: 'PUT',
      query: { path: params.path },
      body: params.content,
      headers,
    });
  },

  listVersions: (projectId: string, path: string, signal?: AbortSignal) =>
    designJson<{ items: t.FileVersion[] }>(projectPath(projectId, 'files', 'versions'), {
      query: { path },
      signal,
    }),

  restoreVersion: (projectId: string, input: { path: string; version: number }) =>
    designJson<{ path: string; version: number }>(projectPath(projectId, 'files', 'restore'), {
      method: 'POST',
      json: input,
    }),

  previewUrl: (projectId: string, input: { path?: string; version?: number } = {}) =>
    designJson<t.PreviewUrl>(projectPath(projectId, 'preview-url'), {
      method: 'POST',
      json: input,
    }),

  listComments: (
    projectId: string,
    params: { path?: string; status?: t.CommentStatus } = {},
    signal?: AbortSignal,
  ) => designJson<t.DesignComment[]>(projectPath(projectId, 'comments'), { query: params, signal }),

  listShares: (projectId: string, signal?: AbortSignal) =>
    designJson<t.DesignShare[]>(projectPath(projectId, 'shares'), { signal }),

  getJob: (jobId: string, signal?: AbortSignal) =>
    designJson<t.DesignJob>(designPath('jobs', jobId), { signal }),

  listTemplates: (kind?: t.TemplateKind, signal?: AbortSignal) =>
    designJson<{ items: t.DesignTemplate[] }>('templates', { query: { kind }, signal }),

  listDesignSystems: (
    params: { query?: string; category?: string; limit?: number; cursor?: string | null },
    signal?: AbortSignal,
  ) => designJson<t.DesignSystemPage>('design-systems', { query: params, signal }),

  getDesignSystem: (systemId: string, signal?: AbortSignal) =>
    designJson<t.DesignSystemDetail>(designPath('design-systems', systemId), { signal }),

  setCompanyDefaultDesignSystem: (designSystemId: string) =>
    designJson<t.CompanyDefaultChange>(designPath('company', 'default-design-system'), {
      method: 'PUT',
      json: { designSystemId },
    }),
};
