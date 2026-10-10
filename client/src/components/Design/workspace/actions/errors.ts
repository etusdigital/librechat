import type { DesignTranslationKey } from '../../i18n';
import { designErrorCode, designErrorMessageKey } from '../../api/errors';

const ACTION_ERROR_KEYS: Record<string, DesignTranslationKey> = {
  permission_required: 'actions.error_permission_required',
  project_read_only: 'actions.error_project_read_only',
  read_only_token: 'actions.error_project_read_only',
  version_not_found: 'actions.error_version_not_found',
  file_not_found: 'actions.error_version_not_found',
  conflict: 'actions.error_conflict',
  project_too_large: 'actions.error_project_too_large',
  export_pptx_forbidden: 'actions.export_reason_pptx_permission',
  export_unsupported_file: 'actions.error_export_unsupported_file',
  export_no_slides: 'actions.error_export_no_slides',
  export_format_unavailable: 'actions.error_export_format_unavailable',
  project_empty: 'actions.error_project_empty',
  export_failed: 'actions.error_export_failed',
  render_failed: 'actions.error_export_failed',
  renderer_unavailable: 'actions.error_export_failed',
  render_timeout: 'actions.error_export_timeout',
  job_timeout: 'actions.error_export_timeout',
  job_interrupted: 'actions.error_export_interrupted',
  jobs_unavailable: 'actions.error_export_failed',
  job_not_found: 'actions.error_export_failed',
  share_expiry_too_long: 'actions.error_share_expiry_too_long',
  share_person_unknown: 'actions.error_share_person_unknown',
};

export function actionErrorKeyOfCode(code: string | null | undefined): DesignTranslationKey | null {
  return code ? (ACTION_ERROR_KEYS[code] ?? null) : null;
}

export function actionErrorMessageKey(
  error: unknown,
  fallback: DesignTranslationKey,
): DesignTranslationKey {
  const known = actionErrorKeyOfCode(designErrorCode(error));
  if (known) {
    return known;
  }
  const general = designErrorMessageKey(error);
  return general === 'error_generic' ? fallback : general;
}

export function jobErrorMessageKey(error: unknown): DesignTranslationKey {
  return (
    actionErrorKeyOfCode(typeof error === 'string' ? error : null) ?? 'actions.error_export_failed'
  );
}
