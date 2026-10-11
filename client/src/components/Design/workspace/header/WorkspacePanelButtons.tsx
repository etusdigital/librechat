import { useCallback } from 'react';
import { Gavel, ListChecks } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { SIDE_PANEL_IDS, useWorkspacePanel } from '../side-panel/use-workspace-panel';
import { useIsResponding } from '../../chat/DesignChatAdapter';
import { usePlanQuery } from '../../api/plan-queries';
import { planProgress } from '../plan/plan-progress';
import { useDesignLocalize } from '../../i18n';
import { useJury } from '../jury/use-jury';
import { cn } from '~/utils';

const pressed = 'bg-surface-active';

export function usePlanToggle() {
  const { toggle } = useWorkspacePanel();
  return useCallback(() => toggle('plan'), [toggle]);
}

export function useJuryToggle() {
  const jury = useJury();
  const { panel, open, close } = useWorkspacePanel();
  const { state, reviewPath, start } = jury;
  return useCallback(() => {
    if (panel === 'jury') {
      close();
      return;
    }
    open('jury');
    if (state.status === 'idle' && reviewPath) {
      start(reviewPath);
    }
  }, [close, open, panel, reviewPath, start, state.status]);
}

export function PlanButton({ projectId }: { projectId: string }) {
  const localize = useDesignLocalize();
  const responding = useIsResponding();
  const { panel } = useWorkspacePanel();
  const toggle = usePlanToggle();
  const { data: plan } = usePlanQuery(projectId, { responding });
  const progress = planProgress(plan);
  const open = panel === 'plan';
  const title = localize('plan.title');
  const label = progress
    ? localize('plan.button_label', {
        finished: progress.finished,
        total: progress.total,
      })
    : title;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={open ? SIDE_PANEL_IDS.plan : undefined}
      onClick={toggle}
      data-testid="design-plan-button"
      className={cn('gap-1.5 max-xl:px-2.5', open && pressed)}
    >
      <ListChecks className="size-4" aria-hidden="true" />
      <span className="hidden xl:inline">{title}</span>
      {progress ? (
        <span
          aria-hidden="true"
          className="rounded-full bg-surface-tertiary px-1.5 text-xs tabular-nums text-text-primary"
        >
          {`${progress.finished}/${progress.total}`}
        </span>
      ) : null}
    </Button>
  );
}

export function JuryButton() {
  const localize = useDesignLocalize();
  const jury = useJury();
  const { panel } = useWorkspacePanel();
  const toggle = useJuryToggle();
  if (!jury.enabled) {
    return null;
  }
  const open = panel === 'jury';
  const label = localize('jury.button');
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={open ? SIDE_PANEL_IDS.jury : undefined}
      aria-busy={jury.busy}
      onClick={toggle}
      data-testid="design-jury-button"
      className={cn('gap-1.5 max-xl:size-9 max-xl:px-0', open && pressed)}
    >
      {jury.busy ? <Spinner className="size-4" /> : <Gavel className="size-4" aria-hidden="true" />}
      <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}
