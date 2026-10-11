import { Button, Spinner } from '@librechat/client';
import { CheckCircle2, Circle, ListChecks, LoaderCircle, MinusCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DesignPlan, PlanItemStatus, PlanTaskType } from '../../api/types';
import type { DesignTranslationKey } from '../../i18n';
import { useIsResponding } from '../../chat/DesignChatAdapter';
import { designErrorMessageKey } from '../../api/errors';
import { usePlanQuery } from '../../api/plan-queries';
import { planProgress } from './plan-progress';
import { useDesignLocalize } from '../../i18n';
import { cn } from '~/utils';

const STATUS: Record<PlanItemStatus, { icon: LucideIcon; key: DesignTranslationKey }> = {
  pending: { icon: Circle, key: 'plan.status_pending' },
  in_progress: { icon: LoaderCircle, key: 'plan.status_in_progress' },
  done: { icon: CheckCircle2, key: 'plan.status_done' },
  skipped: { icon: MinusCircle, key: 'plan.status_skipped' },
};

const TASK_TYPE: Record<PlanTaskType, DesignTranslationKey> = {
  prototype: 'plan.task_prototype',
  deck: 'plan.task_deck',
  marketing: 'plan.task_marketing',
};

function PlanBody({ plan }: { plan: DesignPlan }) {
  const localize = useDesignLocalize();
  const progress = planProgress(plan);
  const percent = progress ? Math.round((progress.finished / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {localize(TASK_TYPE[plan.taskType] ?? 'plan.task_prototype')}
        </span>
        <p className="text-sm font-semibold text-text-primary">{plan.direction.name}</p>
        {plan.direction.summary ? (
          <p className="whitespace-pre-line text-xs text-text-secondary">
            {plan.direction.summary}
          </p>
        ) : null}
      </div>
      {progress ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-text-secondary" data-testid="plan-progress">
            {localize('plan.progress', { finished: progress.finished, total: progress.total })}
          </p>
          <div
            role="progressbar"
            aria-label={localize('plan.progress_label')}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.finished}
            aria-valuetext={localize('plan.progress', {
              finished: progress.finished,
              total: progress.total,
            })}
            className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary"
          >
            <div
              className="h-full rounded-full bg-text-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      ) : null}
      <ol className="flex flex-col gap-1" aria-label={localize('plan.items_label')}>
        {plan.items.map((item, index) => {
          const { icon: Icon, key } = STATUS[item.status] ?? STATUS.pending;
          const current = item.status === 'in_progress';
          return (
            <li
              key={item.id}
              data-testid="plan-item"
              data-status={item.status}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex items-start gap-2 rounded-lg px-2 py-1.5',
                current && 'bg-surface-active',
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  item.status === 'done' || current ? 'text-text-primary' : 'text-text-secondary',
                  current && 'animate-spin motion-reduce:animate-none',
                )}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    'break-words text-sm text-text-primary',
                    item.status === 'skipped' && 'text-text-secondary line-through',
                  )}
                >
                  <span className="sr-only">{`${index + 1}. `}</span>
                  {item.title}
                </span>
                <span className="text-xs text-text-secondary">{localize(key)}</span>
                {item.note ? (
                  <span className="whitespace-pre-line break-words text-xs text-text-secondary">
                    {item.note}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function PlanPanel({ projectId }: { projectId: string }) {
  const localize = useDesignLocalize();
  const responding = useIsResponding();
  const query = usePlanQuery(projectId, { responding });

  let content;
  if (query.isLoading) {
    content = (
      <div role="status" className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="size-4" />
        {localize('plan.loading')}
      </div>
    );
  } else if (query.isError && query.data === undefined) {
    const key = designErrorMessageKey(query.error);
    content = (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-text-secondary">
          {localize(key === 'error_generic' ? 'plan.error' : key)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            query.refetch();
          }}
        >
          {localize('retry')}
        </Button>
      </div>
    );
  } else if (!query.data) {
    content = (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <ListChecks className="size-6 text-text-secondary" aria-hidden="true" />
        <p className="text-sm text-text-secondary">{localize('plan.empty')}</p>
      </div>
    );
  } else {
    content = <PlanBody plan={query.data} />;
  }

  return (
    <div data-testid="plan-panel" className="flex flex-col gap-3 p-3">
      {content}
    </div>
  );
}
