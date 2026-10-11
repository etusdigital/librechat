import type * as t from './types';
import { designJson, designPath } from './client';
import { designKeys } from './queries';

export const planKeys = {
  plan: (projectId: string) => [...designKeys.project(projectId), 'plan'] as const,
};

export const planApi = {
  get: (projectId: string, signal?: AbortSignal) =>
    designJson<{ plan: t.DesignPlan | null }>(designPath('projects', projectId, 'plan'), {
      signal,
    }),
};
