import type { DesignTranslationKey } from '../i18n';

export const DESIGN_ERROR_CODES = {
  reauthRequired: 'reauth_required',
  notAllowed: 'design_not_allowed',
  disabled: 'design_disabled',
  hubUnavailable: 'hub_unavailable',
  serviceUnavailable: 'design_unavailable',
  serviceTimeout: 'design_timeout',
  serviceAuthFailed: 'design_auth_failed',
} as const;

const RETRYABLE_CODES = new Set<string>([
  DESIGN_ERROR_CODES.serviceUnavailable,
  DESIGN_ERROR_CODES.serviceTimeout,
]);

export class DesignApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;
  readonly retryAfterSeconds: number | null;

  constructor({
    status,
    code,
    message,
    details = null,
    retryAfterSeconds = null,
  }: {
    status: number;
    code: string;
    message?: string;
    details?: Record<string, unknown> | null;
    retryAfterSeconds?: number | null;
  }) {
    super(message || code);
    this.name = 'DesignApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isDesignApiError(error: unknown): error is DesignApiError {
  return error instanceof DesignApiError;
}

export function designErrorCode(error: unknown): string | null {
  return isDesignApiError(error) ? error.code : null;
}

export function isRetryableDesignError(error: unknown): boolean {
  if (!isDesignApiError(error)) {
    return true;
  }
  return error.status >= 500 && (RETRYABLE_CODES.has(error.code) || error.code.startsWith('http_'));
}

export function designErrorMessageKey(error: unknown): DesignTranslationKey {
  switch (designErrorCode(error)) {
    case DESIGN_ERROR_CODES.reauthRequired:
      return 'access_reauth';
    case DESIGN_ERROR_CODES.notAllowed:
    case DESIGN_ERROR_CODES.disabled:
      return 'access_denied';
    case DESIGN_ERROR_CODES.hubUnavailable:
      return 'error_hub_unavailable';
    case DESIGN_ERROR_CODES.serviceUnavailable:
    case DESIGN_ERROR_CODES.serviceTimeout:
    case DESIGN_ERROR_CODES.serviceAuthFailed:
      return 'error_design_unavailable';
    default:
      return 'error_generic';
  }
}
