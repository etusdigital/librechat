import type { APIResponse, BrowserContext, Page } from '@playwright/test';
import { CHAT, IDP_HOST, type Persona } from './env';

async function isControlled(page: Page, timeout: number) {
  try {
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, {
      timeout,
    });
    return true;
  } catch {
    return false;
  }
}

export async function waitForServiceWorker(page: Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await isControlled(page, 15_000)) {
      await page.waitForLoadState('load');
      return;
    }
    await page.reload({ waitUntil: 'load' }).catch(() => undefined);
  }
  throw new Error('the chat service worker never took control of the page');
}

export async function choosePersona(context: BrowserContext, persona: Persona) {
  await context.addCookies([
    {
      name: 'e2e_persona',
      value: persona,
      domain: IDP_HOST,
      path: '/',
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

export async function loginAs(
  page: Page,
  persona: Persona,
  { serviceWorker = false }: { serviceWorker?: boolean } = {},
) {
  await choosePersona(page.context(), persona);
  await page.goto('/oauth/openid');
  await page.waitForURL(
    (url) =>
      url.origin === CHAT &&
      !url.pathname.startsWith('/oauth') &&
      !url.pathname.startsWith('/login'),
    { timeout: 60_000 },
  );
  await page.locator('#prompt-textarea').waitFor({ timeout: 60_000 });
  if (serviceWorker) {
    await waitForServiceWorker(page);
  }
}

export async function gotoPath(page: Page, path: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path);
      return;
    } catch (error) {
      if (attempt === 2 || !/ABORTED|interrupted|net::ERR_ABORTED/i.test(String(error))) {
        throw error;
      }
      await page.waitForLoadState('load').catch(() => undefined);
    }
  }
}

type Body = { json?: unknown; data?: string | Buffer; contentType?: string };

export class DesignApi {
  private token: { value: string; at: number } | null = null;

  constructor(private readonly context: BrowserContext) {}

  async bearer() {
    if (this.token && Date.now() - this.token.at < 60_000) {
      return this.token.value;
    }
    const response = await this.context.request.post(`${CHAT}/api/auth/refresh`);
    if (!response.ok()) {
      throw new Error(`refresh failed with ${response.status()}`);
    }
    const { token } = (await response.json()) as { token: string };
    this.token = { value: token, at: Date.now() };
    return token;
  }

  async raw(
    method: string,
    path: string,
    { json, data, contentType, headers = {} }: Body & { headers?: Record<string, string> } = {},
  ): Promise<APIResponse> {
    const authorization = `Bearer ${await this.bearer()}`;
    return this.context.request.fetch(`${CHAT}/api/etus/design/${path}`, {
      method,
      headers: {
        authorization,
        ...(contentType ? { 'content-type': contentType } : {}),
        ...headers,
      },
      ...(json !== undefined ? { data: json } : {}),
      ...(data !== undefined ? { data } : {}),
    });
  }

  async json<T>(
    method: string,
    path: string,
    body: Body & { headers?: Record<string, string> } = {},
  ) {
    const response = await this.raw(method, path, body);
    if (!response.ok()) {
      throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    }
    return (response.status() === 204 ? undefined : await response.json()) as T;
  }

  createProject(input: {
    name: string;
    kind?: string;
    designSystemId?: string;
    templateId?: string;
  }) {
    return this.json<{ projectId: string; entryFile: string }>('POST', 'projects', {
      json: { kind: 'prototype', ...input },
    });
  }

  writeFile(
    projectId: string,
    path: string,
    content: string,
    {
      contentType = 'text/html; charset=utf-8',
      source,
    }: { contentType?: string; source?: string } = {},
  ) {
    return this.json<{ path: string; version: number; sha256: string }>(
      'PUT',
      `projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
      {
        data: content,
        contentType,
        headers: source ? { 'x-etus-version-source': source } : {},
      },
    );
  }

  async readFile(projectId: string, path: string, version?: number) {
    const query = new URLSearchParams({ path, ...(version ? { version: String(version) } : {}) });
    const response = await this.raw('GET', `projects/${projectId}/files/content?${query}`);
    if (!response.ok()) {
      throw new Error(`read ${path} answered ${response.status()}`);
    }
    return response.text();
  }

  versions(projectId: string, path: string) {
    return this.json<{ items: Array<{ version: number; source: string; sha256: string }> }>(
      'GET',
      `projects/${projectId}/files/versions?path=${encodeURIComponent(path)}`,
    );
  }

  comments(projectId: string, path: string) {
    return this.json<
      Array<{
        id?: string;
        commentId?: string;
        body: string;
        status: string;
        sentToChatAt?: string | null;
      }>
    >('GET', `projects/${projectId}/comments?path=${encodeURIComponent(path)}`);
  }

  conversations(projectId: string) {
    return this.json<{ items: Array<{ conversationId: string }> }>(
      'GET',
      `projects/${projectId}/conversations`,
    );
  }
}

export async function newProject(
  api: DesignApi,
  name: string,
  files: Record<string, string>,
  options: { designSystemId?: string } = {},
) {
  const project = await api.createProject({ name, ...options });
  for (const [path, content] of Object.entries(files)) {
    const contentType = path.endsWith('.css') ? 'text/css; charset=utf-8' : undefined;
    await api.writeFile(project.projectId, path, content, {
      ...(contentType ? { contentType } : {}),
      source: 'agent',
    });
  }
  return project;
}
