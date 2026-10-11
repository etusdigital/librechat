import type { DesignPlan, DesignPlanItem, PlanItemStatus } from '../../api/types';

export interface PlanProgress {
  total: number;
  finished: number;
  done: number;
  skipped: number;
  current: DesignPlanItem | null;
  complete: boolean;
}

const FINISHED: ReadonlySet<PlanItemStatus> = new Set(['done', 'skipped']);

export function planProgress(plan: DesignPlan | null | undefined): PlanProgress | null {
  if (!plan || plan.items.length === 0) {
    return null;
  }
  const done = plan.items.filter((item) => item.status === 'done').length;
  const skipped = plan.items.filter((item) => item.status === 'skipped').length;
  const finished = done + skipped;
  return {
    total: plan.items.length,
    finished,
    done,
    skipped,
    current:
      plan.items.find((item) => item.status === 'in_progress') ??
      plan.items.find((item) => !FINISHED.has(item.status)) ??
      null,
    complete: finished === plan.items.length,
  };
}

export interface PlanChange {
  item: DesignPlanItem;
  from: PlanItemStatus | null;
}

export function planChanges(
  previous: DesignPlan | null | undefined,
  next: DesignPlan | null | undefined,
): PlanChange[] {
  if (!next) {
    return [];
  }
  if (!previous || previous.planId !== next.planId) {
    return [];
  }
  const before = new Map(previous.items.map((item) => [item.id, item.status]));
  return next.items
    .filter((item) => before.get(item.id) !== item.status)
    .map((item) => ({ item, from: before.get(item.id) ?? null }));
}
