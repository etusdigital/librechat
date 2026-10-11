import { useCallback, useId, useRef, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, useMediaQuery } from '@librechat/client';
import { Crosshair, Gavel, MessagesSquare, TriangleAlert } from 'lucide-react';
import type { DesignReview, ReviewFinding, ReviewMustFix } from '../../api/types';
import type { JuryState } from './jury-state';
import {
  DEVICE_KEYS,
  DIMENSION_KEYS,
  REVIEW_DIMENSIONS,
  buildJuryChatRequest,
  formatCost,
  formatScore,
  highlightDevice,
  isCssSelector,
  juryErrorMessageKey,
} from './jury-request';
import {
  deviceAtom,
  openTab,
  previewHighlightAtom,
  workspaceTabsAtomFamily,
} from '../../state/atoms';
import { useDesignChatActions } from '../../chat/DesignChatAdapter';
import { useFocusWorkspaceTab } from '../workspace-tabs';
import { COMPACT_LAYOUT_QUERY } from '../layout';
import { useDesignLocalize } from '../../i18n';
import { shownReviewOf } from './jury-state';
import { useJury } from './use-jury';
import { cn } from '~/utils';

type Finding = ReviewFinding & Partial<Pick<ReviewMustFix, 'severity' | 'source' | 'rule'>>;
type SendState = 'idle' | 'sending' | 'sent' | 'inserted' | 'failed';

const chip =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-text-primary';

function useLocale() {
  const { i18n } = useTranslation();
  return i18n?.language;
}

function useShowInPreview(projectId: string) {
  const setTabs = useSetAtom(workspaceTabsAtomFamily(projectId));
  const [device, setDevice] = useAtom(deviceAtom);
  const setHighlight = useSetAtom(previewHighlightAtom);
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const { focus } = useFocusWorkspaceTab();
  return useCallback(
    (review: DesignReview, finding: Finding) => {
      if (!isCssSelector(finding.where)) {
        return;
      }
      setTabs((current) => openTab(current, review.path));
      const target = compact ? null : highlightDevice(finding, review.facts, device);
      if (target) {
        setDevice(target);
      }
      setHighlight({ id: Date.now(), path: review.path, selector: finding.where });
      focus('preview');
    },
    [compact, device, focus, setDevice, setHighlight, setTabs],
  );
}

function FindingItem({
  finding,
  review,
  onShow,
}: {
  finding: Finding;
  review: DesignReview;
  onShow: (review: DesignReview, finding: Finding) => void;
}) {
  const localize = useDesignLocalize();
  const issueId = useId();
  const showable = isCssSelector(finding.where);
  return (
    <li
      data-testid="jury-finding"
      className="flex flex-col gap-1.5 rounded-lg border border-border-light bg-surface-primary p-2.5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn(chip, 'border-border-medium')}>
          {localize(DIMENSION_KEYS[finding.dimension] ?? 'jury.dimension_visual')}
        </span>
        {finding.severity === 'critical' ? (
          <span className={cn(chip, 'border-status-error-border bg-status-error-subtle')}>
            {localize('jury.severity_critical')}
          </span>
        ) : null}
        {finding.source === 'axe' ? (
          <span className={cn(chip, 'border-border-medium')}>{localize('jury.source_axe')}</span>
        ) : null}
      </div>
      <p id={issueId} className="break-words text-sm text-text-primary">
        {finding.issue}
      </p>
      {finding.where ? (
        <code className="break-all rounded bg-surface-secondary px-1.5 py-0.5 text-xs text-text-primary">
          {finding.where}
        </code>
      ) : null}
      <p className="break-words text-xs text-text-secondary">
        <span className="font-medium text-text-primary">{localize('jury.fix_label')} </span>
        {finding.fix}
      </p>
      {showable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby={issueId}
          onClick={() => onShow(review, finding)}
          className="gap-1.5 self-start"
        >
          <Crosshair className="size-4" aria-hidden="true" />
          {localize('jury.show_in_preview')}
        </Button>
      ) : null}
    </li>
  );
}

function FindingList({
  title,
  findings,
  review,
  onShow,
  testId,
}: {
  title: string;
  findings: Finding[];
  review: DesignReview;
  onShow: (review: DesignReview, finding: Finding) => void;
  testId: string;
}) {
  const headingId = useId();
  if (findings.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-text-primary">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {findings.map((finding, index) => (
          <FindingItem
            key={`${finding.dimension}-${index}`}
            finding={finding}
            review={review}
            onShow={onShow}
          />
        ))}
      </ul>
    </section>
  );
}

function ScoreCard({ review }: { review: DesignReview }) {
  const localize = useDesignLocalize();
  const locale = useLocale();
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-border-light bg-surface-primary p-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col">
          <h3 id={headingId} className="text-xs font-medium text-text-secondary">
            {localize('jury.overall')}
          </h3>
          <p className="flex items-baseline gap-1 text-text-primary">
            <span data-testid="jury-score" className="text-3xl font-semibold tabular-nums">
              {formatScore(review.weightedScore, locale)}
            </span>
            <span className="text-sm text-text-secondary">{localize('jury.out_of_ten')}</span>
          </p>
        </div>
        <span
          data-testid="jury-verdict"
          className={cn(
            chip,
            review.ship
              ? 'border-status-success-border bg-status-success-subtle'
              : 'border-status-warning-border bg-status-warning-subtle',
          )}
        >
          {review.ship
            ? localize('jury.ship')
            : localize('jury.below_threshold', {
                threshold: formatScore(review.threshold, locale),
              })}
        </span>
      </div>
      <p className="text-xs text-text-secondary">
        {localize('jury.round', { round: review.round, max: review.maxRounds })}
      </p>
      <ul className="flex flex-col gap-2" aria-label={localize('jury.dimensions_label')}>
        {REVIEW_DIMENSIONS.map((dimension) => {
          const value = review.scores[dimension] ?? 0;
          return (
            <li key={dimension} data-testid={`jury-dimension-${dimension}`} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary">{localize(DIMENSION_KEYS[dimension])}</span>
                <span className="tabular-nums text-text-primary">
                  {formatScore(value, locale)}
                  <span className="sr-only"> {localize('jury.out_of_ten')}</span>
                </span>
              </div>
              <div
                aria-hidden="true"
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
              >
                <div
                  className="h-full rounded-full bg-text-primary"
                  style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {review.summary ? (
        <p className="whitespace-pre-line break-words text-sm text-text-secondary">
          {review.summary}
        </p>
      ) : null}
    </section>
  );
}

function FactsList({ review }: { review: DesignReview }) {
  const localize = useDesignLocalize();
  const headingId = useId();
  const { facts } = review;
  let scroll: string;
  if (facts.horizontalScrollAt390 == null) {
    scroll = localize('jury.fact_not_checked');
  } else {
    scroll = localize(facts.horizontalScrollAt390 ? 'jury.fact_yes' : 'jury.fact_no');
  }
  const rows: [string, string][] = [
    [localize('jury.fact_axe'), String(facts.axeViolations)],
    [localize('jury.fact_scroll'), scroll],
    [localize('jury.fact_console'), String(facts.consoleErrors)],
    [
      localize('jury.fact_fonts'),
      facts.fontsLoaded.length > 0 ? facts.fontsLoaded.join(', ') : localize('jury.fact_none'),
    ],
  ];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-text-primary">
        {localize('jury.facts_title')}
      </h3>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-text-secondary">{term}</dt>
            <dd className="break-words text-right text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Screenshots({ review }: { review: DesignReview }) {
  const localize = useDesignLocalize();
  const headingId = useId();
  const shots = review.screenshots.filter((shot) => shot.url);
  if (shots.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-text-primary">
        {localize('jury.screenshots_title')}
      </h3>
      <ul className="grid grid-cols-2 gap-2">
        {shots.map((shot) => {
          const alt = localize('jury.screenshot_alt', {
            device: localize(DEVICE_KEYS[shot.device] ?? 'workspace.preview.device_desktop'),
            part: shot.part,
            parts: shot.parts,
          });
          return (
            <li key={`${shot.device}-${shot.part}`}>
              <a
                href={shot.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="block overflow-hidden rounded-lg border border-border-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
              >
                <img
                  src={shot.url ?? undefined}
                  alt={alt}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-[3/4] w-full bg-surface-secondary object-cover object-top"
                />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReviewResult({ review, projectId }: { review: DesignReview; projectId: string }) {
  const localize = useDesignLocalize();
  const locale = useLocale();
  const show = useShowInPreview(projectId);
  return (
    <div data-testid="jury-result" className="flex flex-col gap-4">
      <ScoreCard review={review} />
      <FindingList
        testId="jury-must-fix"
        title={localize('jury.must_fix_title', { count: review.mustFix.length })}
        findings={review.mustFix}
        review={review}
        onShow={show}
      />
      {review.mustFix.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('jury.must_fix_none')}</p>
      ) : null}
      <FindingList
        testId="jury-nice-to-have"
        title={localize('jury.nice_to_have_title', { count: review.niceToHave.length })}
        findings={review.niceToHave}
        review={review}
        onShow={show}
      />
      <FactsList review={review} />
      <Screenshots review={review} />
      {review.costUsd != null ? (
        <p className="text-xs text-text-secondary">
          {localize('jury.cost', { cost: formatCost(review.costUsd, locale) })}
        </p>
      ) : null}
    </div>
  );
}

function StatusNotice({ state }: { state: JuryState }) {
  const localize = useDesignLocalize();
  if (state.status === 'requesting' || state.status === 'running') {
    return (
      <div
        role="status"
        data-testid="jury-running"
        className="flex items-start gap-2 rounded-lg border border-border-light bg-surface-primary p-3 text-sm text-text-primary"
      >
        <Spinner className="mt-0.5 size-4 shrink-0" />
        <span>{localize('jury.running', { path: state.path })}</span>
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <div
        role="alert"
        data-testid="jury-error"
        className="flex items-start gap-2 rounded-lg border border-status-error-border bg-status-error-subtle p-3 text-sm text-text-primary"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{localize(juryErrorMessageKey(state.code))}</span>
      </div>
    );
  }
  if (state.status === 'round_limit') {
    return (
      <div
        role="status"
        data-testid="jury-round-limit"
        className="flex flex-col gap-1 rounded-lg border border-status-warning-border bg-status-warning-subtle p-3 text-sm text-text-primary"
      >
        <span>{localize('jury.round_limit', { path: state.path, count: state.maxRounds })}</span>
        <span className="text-xs">
          {localize(state.best ? 'jury.round_limit_best' : 'jury.round_limit_none')}
        </span>
      </div>
    );
  }
  return null;
}

function useAskForFixes(review: DesignReview | null) {
  const localize = useDesignLocalize();
  const locale = useLocale();
  const { sendMessage, insertIntoComposer } = useDesignChatActions();
  const { focus } = useFocusWorkspaceTab();
  const [state, setState] = useState<SendState>('idle');
  const sending = useRef(false);

  const ask = useCallback(async () => {
    if (!review || sending.current || review.mustFix.length === 0) {
      return;
    }
    sending.current = true;
    setState('sending');
    const text = buildJuryChatRequest({ review, localize, locale });
    let next: SendState = 'failed';
    if (await sendMessage(text)) {
      next = 'sent';
    } else if (await insertIntoComposer(text)) {
      next = 'inserted';
    }
    if (next !== 'failed') {
      focus('chat');
    }
    sending.current = false;
    setState(next);
  }, [focus, insertIntoComposer, locale, localize, review, sendMessage]);

  return { state, ask };
}

export default function JuryPanel({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const localize = useDesignLocalize();
  const { state, busy, reviewPath, start } = useJury();
  const review = shownReviewOf(state);
  const fixes = useAskForFixes(review);
  const sameFile = review != null && review.path === reviewPath;
  const limited = state.status === 'round_limit' && state.path === reviewPath;

  let reviewLabel: string;
  if (busy) {
    reviewLabel = localize('jury.reviewing');
  } else if (sameFile) {
    reviewLabel = localize('jury.review_again');
  } else {
    reviewLabel = localize('jury.review_file', { path: reviewPath ?? '' });
  }

  return (
    <div data-testid="jury-panel" className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-3 p-3">
        <p className="text-xs text-text-secondary">
          {reviewPath ? localize('jury.hint') : localize('jury.no_html')}
        </p>
        <StatusNotice state={state} />
        {review ? <ReviewResult review={review} projectId={projectId} /> : null}
        {state.status === 'idle' && reviewPath ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Gavel className="size-6 text-text-secondary" aria-hidden="true" />
            <p className="text-sm text-text-secondary">{localize('jury.empty')}</p>
          </div>
        ) : null}
      </div>
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border-light bg-presentation p-3">
        <div aria-live="polite" className="text-xs text-text-secondary">
          {fixes.state === 'sent' ? localize('jury.ask_sent') : ''}
          {fixes.state === 'inserted' ? localize('jury.ask_inserted') : ''}
        </div>
        {fixes.state === 'failed' ? (
          <p role="alert" className="text-xs text-text-destructive">
            {localize('jury.ask_error')}
          </p>
        ) : null}
        {review && canWrite && review.mustFix.length > 0 ? (
          <Button
            type="button"
            size="sm"
            disabled={fixes.state === 'sending'}
            aria-busy={fixes.state === 'sending'}
            onClick={() => {
              fixes.ask();
            }}
            data-testid="jury-ask-fixes"
            className="gap-1.5"
          >
            {fixes.state === 'sending' ? (
              <Spinner className="size-4" />
            ) : (
              <MessagesSquare className="size-4" aria-hidden="true" />
            )}
            {localize('jury.ask_fixes')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={review && canWrite && review.mustFix.length > 0 ? 'outline' : 'default'}
          size="sm"
          disabled={!reviewPath || busy || limited}
          aria-busy={busy}
          onClick={() => {
            if (reviewPath) {
              start(reviewPath);
            }
          }}
          data-testid="jury-review"
          className="gap-1.5"
        >
          {busy ? <Spinner className="size-4" /> : <Gavel className="size-4" aria-hidden="true" />}
          {reviewLabel}
        </Button>
      </div>
    </div>
  );
}
