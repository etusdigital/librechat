import fs from 'node:fs/promises';
import { FAKE_LLM, HUB_ADMIN, NGINX_LOG, STATE_DIR } from './env';

export type HubCall = {
  at: number;
  kind: 'login' | 'refresh' | 'forward-token' | 'company-setting';
  persona: string | null;
  chatKey?: boolean;
  idToken?: boolean;
  appKey?: string | null;
  field?: string;
  value?: unknown;
  personToken?: boolean;
};

export async function hubCalls(): Promise<HubCall[]> {
  const response = await fetch(`${HUB_ADMIN}/__calls`);
  return (await response.json()) as HubCall[];
}

export async function companySettings(): Promise<Record<string, unknown>> {
  return (await (await fetch(`${HUB_ADMIN}/__company`)).json()) as Record<string, unknown>;
}

export type ModelRequest = {
  at: number;
  model: string;
  firstLine: string;
  first: string;
  last: string;
  userMessages: number;
  lastImages: number;
};

export async function modelRequests(): Promise<ModelRequest[]> {
  return (await (await fetch(`${FAKE_LLM}/__requests`)).json()) as ModelRequest[];
}

export async function waitForModelRequest(
  match: (request: ModelRequest) => boolean,
  timeoutMs = 60_000,
): Promise<ModelRequest> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await modelRequests()).find(match);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('the fake model never received the expected request');
}

export async function nginxLog(): Promise<string[]> {
  return (await fs.readFile(NGINX_LOG, 'utf8')).split('\n').filter(Boolean);
}

export async function waitForAgentSeed(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(`${STATE_DIR}/agent-seeded`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('the Etus Design agent was never seeded');
}
