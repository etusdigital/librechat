import type { APIRequestContext } from '@playwright/test';
import { CHAT, HUB_ADMIN, type Persona } from './env';

export const DESIGN_MCP = `${CHAT}/etus-design/api/mcp`;

async function forwardToken(persona: Persona) {
  const response = await fetch(`${HUB_ADMIN}/__forward-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ persona }),
  });
  if (!response.ok) {
    throw new Error(`forward token for ${persona} answered ${response.status}`);
  }
  return ((await response.json()) as { token: string }).token;
}

export async function callDesignTool<T>(
  request: APIRequestContext,
  persona: Persona,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await request.post(DESIGN_MCP, {
    headers: {
      authorization: `Bearer ${await forwardToken(persona)}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const body = (await response.json()) as {
    error?: unknown;
    result?: { isError?: boolean; structuredContent?: T; content?: unknown };
  };
  if (!response.ok() || body.error || !body.result || body.result.isError) {
    throw new Error(`${name} failed with ${response.status()}: ${JSON.stringify(body)}`);
  }
  return body.result.structuredContent as T;
}

export type PlanView = {
  planId: string;
  items: Array<{ id: string; title: string; status: string }>;
};

export const agent = (request: APIRequestContext, persona: Persona = 'ana') => ({
  savePlan: (projectId: string, titles: string[]) =>
    callDesignTool<PlanView>(request, persona, 'save_plan', {
      projectId,
      taskType: 'deck',
      direction: { name: 'Editorial sóbrio', summary: 'Títulos fortes e muito respiro.' },
      items: titles.map((title) => ({ title })),
    }),
  updateItem: (planId: string, itemId: string, status: string, note?: string) =>
    callDesignTool<PlanView>(request, persona, 'update_plan_item', {
      planId,
      itemId,
      status,
      ...(note ? { note } : {}),
    }),
});
