import type {
  DesignReview,
  ReviewDevice,
  ReviewDimension,
  ReviewFacts,
  ReviewFinding,
  ReviewMustFix,
} from '../../api/types';
import type { DesignTranslationKey } from '../../i18n';
import { designErrorMessageKey } from '../../api/errors';

type Localize = (key: DesignTranslationKey, options?: Record<string, unknown>) => string;

export const REVIEW_DIMENSIONS: readonly ReviewDimension[] = [
  'visual',
  'brand',
  'accessibility',
  'copy',
];

export const DIMENSION_KEYS: Record<ReviewDimension, DesignTranslationKey> = {
  visual: 'jury.dimension_visual',
  brand: 'jury.dimension_brand',
  accessibility: 'jury.dimension_accessibility',
  copy: 'jury.dimension_copy',
};

export const DEVICE_KEYS: Record<ReviewDevice, DesignTranslationKey> = {
  mobile: 'workspace.preview.device_mobile',
  tablet: 'workspace.preview.device_tablet',
  desktop: 'workspace.preview.device_desktop',
};

const JURY_ERROR_KEYS: Record<string, DesignTranslationKey> = {
  jury_unavailable: 'jury.error_unavailable',
  jury_invalid_output: 'jury.error_invalid_output',
  jury_timeout: 'jury.error_timeout',
  review_unsupported_file: 'jury.error_unsupported_file',
  file_not_found: 'jury.error_file_not_found',
  permission_required: 'jury.error_permission',
  no_router_key: 'jury.error_no_router_key',
  router_limit: 'jury.error_router_limit',
  router_busy: 'jury.error_router_busy',
  router_unavailable: 'jury.error_router_unavailable',
  router_timeout: 'jury.error_router_unavailable',
  router_auth_failed: 'jury.error_router_unavailable',
  router_rejected: 'jury.error_router_unavailable',
  router_failed: 'jury.error_router_unavailable',
  renderer_unavailable: 'jury.error_render',
  render_failed: 'jury.error_render',
  render_timeout: 'jury.error_render',
  retry_needed: 'jury.error_interrupted',
  job_interrupted: 'jury.error_interrupted',
  job_not_found: 'jury.error_interrupted',
};

export function juryErrorMessageKey(code: string | null, error?: unknown): DesignTranslationKey {
  const known = code ? JURY_ERROR_KEYS[code] : undefined;
  if (known) {
    return known;
  }
  const general = designErrorMessageKey(error);
  return general === 'error_generic' ? 'jury.error_generic' : general;
}

export function formatScore(value: number, locale?: string) {
  return new Intl.NumberFormat(locale || undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatCost(value: number, locale?: string) {
  return new Intl.NumberFormat(locale || undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

const HTML_TAGS = new Set(
  (
    'a abbr address article aside audio b blockquote body button canvas caption code dd details ' +
    'dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr html i ' +
    'iframe img input label legend li main mark nav ol option p picture pre section select small ' +
    'span strong sub summary sup svg table tbody td textarea tfoot th thead time tr u ul video'
  ).split(' '),
);

function looksLikeProse(value: string) {
  const words = value.trim().split(/\s+/);
  return /^[a-z\s]+$/i.test(value) && words.some((word) => !HTML_TAGS.has(word.toLowerCase()));
}

export function isCssSelector(value: string | undefined | null): value is string {
  if (!value || !value.trim() || value.length > 1000 || looksLikeProse(value)) {
    return false;
  }
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    document.createDocumentFragment().querySelector(value);
    return true;
  } catch {
    return false;
  }
}

export function devicesOfFinding(
  finding: Pick<ReviewMustFix, 'where'> & { rule?: string },
  facts: Pick<ReviewFacts, 'violations'>,
): ReviewDevice[] {
  const fact = facts.violations.find(
    (violation) =>
      (finding.rule != null && violation.rule === finding.rule) ||
      (finding.where != null && violation.targets.includes(finding.where)),
  );
  return fact?.devices ?? [];
}

export function highlightDevice(
  finding: Pick<ReviewMustFix, 'where'> & { rule?: string },
  facts: Pick<ReviewFacts, 'violations'>,
  current: string,
): ReviewDevice | null {
  const devices = devicesOfFinding(finding, facts);
  if (devices.length === 0 || devices.includes(current as ReviewDevice)) {
    return null;
  }
  return devices[0];
}

function sentence(text: string) {
  const trimmed = text.trim();
  return /[.!?:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function findingLine(
  finding: ReviewFinding & { severity?: ReviewMustFix['severity'] },
  index: number,
  localize: Localize,
) {
  const dimension = localize(DIMENSION_KEYS[finding.dimension]);
  const label =
    finding.severity === 'critical'
      ? `${dimension}, ${localize('jury.severity_critical').toLowerCase()}`
      : dimension;
  const where = finding.where?.trim() ? ` [${finding.where.trim()}]` : '';
  return `${index + 1}. ${label}${where}: ${sentence(finding.issue)} ${localize(
    'jury.chat_fix_prefix',
  )} ${sentence(finding.fix)}`;
}

export function buildJuryChatRequest({
  review,
  localize,
  locale,
}: {
  review: DesignReview;
  localize: Localize;
  locale?: string;
}) {
  const header = localize('jury.chat_header', {
    path: review.path,
    score: formatScore(review.weightedScore, locale),
    round: review.round,
    max: review.maxRounds,
  });
  const lines = review.mustFix.map((finding, index) => findingLine(finding, index, localize));
  const footer = localize(
    review.round < review.maxRounds ? 'jury.chat_footer_again' : 'jury.chat_footer_last',
  );
  return [header, ...lines, footer].join('\n');
}
