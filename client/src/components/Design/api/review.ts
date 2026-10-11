import { request } from 'librechat-data-provider';
import type * as t from './types';
import { designPath, designUrl, errorOf } from './client';

export interface ReviewRequest {
  path: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function roundLimitOf(
  response: Response,
  projectId: string,
  path: string,
): Promise<t.ReviewOutcome | null> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!error || error.code !== 'round_limit') {
    return null;
  }
  const review =
    isRecord(body) && isRecord(body.review) ? (body.review as unknown as t.DesignReview) : null;
  return {
    status: 'round_limit',
    projectId,
    path: review?.path ?? path,
    maxRounds: typeof error.maxRounds === 'number' ? error.maxRounds : 0,
    best: review,
  };
}

export const reviewApi = {
  request: async (
    projectId: string,
    input: ReviewRequest,
    signal?: AbortSignal,
  ): Promise<t.ReviewOutcome> => {
    const response = await request.authenticatedFetch(
      designUrl(designPath('projects', projectId, 'reviews')),
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      },
    );
    if (response.status === 429) {
      const limited = await roundLimitOf(response, projectId, input.path);
      if (limited) {
        return limited;
      }
    }
    if (!response.ok) {
      throw await errorOf(response);
    }
    return (await response.json()) as t.ReviewOutcome;
  },
};
