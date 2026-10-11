import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { DesignJob, DesignReview, FileEntry } from '../../api/types';
import { fileKindOf } from '../file-kind';

export type JuryState =
  | { status: 'idle' }
  | { status: 'requesting'; path: string }
  | { status: 'running'; path: string; jobId: string }
  | { status: 'done'; path: string; review: DesignReview }
  | { status: 'round_limit'; path: string; maxRounds: number; best: DesignReview | null }
  | { status: 'failed'; path: string; code: string | null };

export const IDLE_JURY: JuryState = { status: 'idle' };

export const juryAtomFamily = atomFamily((_projectId: string) => atom<JuryState>(IDLE_JURY));

export interface StoredJury {
  jobId: string;
  path: string;
}

const STORAGE_PREFIX = 'etus-design:jury:';

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredJury(projectId: string, storage = sessionStore()): StoredJury | null {
  try {
    const raw = storage?.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<StoredJury>;
    return typeof value.jobId === 'string' && typeof value.path === 'string'
      ? { jobId: value.jobId, path: value.path }
      : null;
  } catch {
    return null;
  }
}

export function storeJury(projectId: string, value: StoredJury | null, storage = sessionStore()) {
  try {
    const key = `${STORAGE_PREFIX}${projectId}`;
    if (value) {
      storage?.setItem(key, JSON.stringify(value));
    } else {
      storage?.removeItem(key);
    }
  } catch {
    return;
  }
}

export function isJuryBusy(state: JuryState) {
  return state.status === 'requesting' || state.status === 'running';
}

export function reviewOfJob(job: DesignJob | undefined): DesignReview | null {
  const output = job?.output;
  return output && typeof output.reviewId === 'string' ? (output as unknown as DesignReview) : null;
}

export function jobErrorCodeOf(job: DesignJob | undefined): string | null {
  const error = job?.error;
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return null;
}

export function isReviewable(file: Pick<FileEntry, 'path' | 'mime'> | undefined) {
  return file != null && fileKindOf(file.path, file.mime) === 'html';
}

export function reviewPathOf(
  files: Pick<FileEntry, 'path' | 'mime'>[],
  activePath: string,
  entry: string,
): string | null {
  const byPath = (path: string) => files.find((file) => file.path === path);
  if (isReviewable(byPath(activePath))) {
    return activePath;
  }
  return isReviewable(byPath(entry)) ? entry : null;
}

export function shownReviewOf(state: JuryState): DesignReview | null {
  if (state.status === 'done') {
    return state.review;
  }
  return state.status === 'round_limit' ? state.best : null;
}

const JURY_STEP = /^revisar com (?:o )?juri\b/;

export function isJuryStep(step: string) {
  const normalized = step
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return JURY_STEP.test(normalized);
}
