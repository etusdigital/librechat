import type { DeviceId } from '../../state/atoms';
import type { DesignJob } from '../../api/types';
import type { Size } from '../preview-geometry';
import { designApi, designJson, designPath } from '../../api/client';
import { DEVICES } from '../../state/atoms';

export type ScreenshotDevice = Exclude<DeviceId, 'free'>;

const SCREENSHOT_DEVICES: readonly ScreenshotDevice[] = ['mobile', 'tablet', 'desktop'];
const POLL_MS = 1000;
const TIMEOUT_MS = 120_000;

export class ScreenshotError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ScreenshotError';
    this.code = code;
  }
}

export function screenshotDevice(device: DeviceId, viewport: Size): ScreenshotDevice {
  if (device !== 'free') {
    return device;
  }
  return SCREENSHOT_DEVICES.reduce((best, candidate) =>
    Math.abs(DEVICES[candidate].width - viewport.width) <
    Math.abs(DEVICES[best].width - viewport.width)
      ? candidate
      : best,
  );
}

export const drawApi = {
  requestScreenshot: (
    projectId: string,
    input: { path: string; devices: ScreenshotDevice[]; fullPage: boolean },
  ) =>
    designJson<DesignJob>(designPath('projects', projectId, 'screenshots'), {
      method: 'POST',
      json: input,
    }),
  getJob: (jobId: string, signal?: AbortSignal) => designApi.getJob(jobId, signal),
};

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function jobErrorCode(job: DesignJob) {
  const error = job.error;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'screenshot_failed';
}

export function screenshotUrlOf(job: DesignJob): string | null {
  const url = job.downloads[0]?.url ?? job.downloadUrl;
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export async function downloadScreenshot(url: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new ScreenshotError('screenshot_download_failed');
  }
  return new Blob([await response.arrayBuffer()], { type: 'image/png' });
}

export async function captureScreenshot({
  projectId,
  path,
  device,
  signal,
  pollMs = POLL_MS,
  timeoutMs = TIMEOUT_MS,
  now = Date.now,
}: {
  projectId: string;
  path: string;
  device: ScreenshotDevice;
  signal?: AbortSignal;
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
}): Promise<Blob> {
  const deadline = now() + timeoutMs;
  let job = await drawApi.requestScreenshot(projectId, {
    path,
    devices: [device],
    fullPage: false,
  });
  while (job.status === 'queued' || job.status === 'running') {
    if (now() >= deadline) {
      throw new ScreenshotError('screenshot_timeout');
    }
    await wait(pollMs, signal);
    job = await drawApi.getJob(job.jobId, signal);
  }
  if (job.status !== 'succeeded') {
    throw new ScreenshotError(jobErrorCode(job));
  }
  const url = screenshotUrlOf(job);
  if (!url) {
    throw new ScreenshotError('screenshot_failed');
  }
  return downloadScreenshot(url, signal);
}
