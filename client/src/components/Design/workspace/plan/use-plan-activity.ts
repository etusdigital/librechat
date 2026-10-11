import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import type { DesignPlan, PlanItemStatus } from '../../api/types';
import type { DesignTranslationKey } from '../../i18n';
import { workspaceModeAtom, workspacePanelAtom } from '../../state/atoms';
import { usePlanQuery } from '../../api/plan-queries';
import { useDesignLocalize } from '../../i18n';
import { planChanges } from './plan-progress';
import { modeExtension } from '../modes';

const ANNOUNCE: Partial<Record<PlanItemStatus, DesignTranslationKey>> = {
  in_progress: 'plan.announce_in_progress',
  done: 'plan.announce_done',
  skipped: 'plan.announce_skipped',
};

export function planAnnouncementKey(
  before: DesignPlan | null,
  plan: DesignPlan,
): { key: DesignTranslationKey; options: Record<string, unknown> } | null {
  if (!before || before.planId !== plan.planId) {
    return { key: 'plan.announce_new', options: { count: plan.items.length } };
  }
  const last = planChanges(before, plan)
    .filter(({ item }) => ANNOUNCE[item.status])
    .pop();
  if (!last) {
    return null;
  }
  return {
    key: ANNOUNCE[last.item.status] as DesignTranslationKey,
    options: { title: last.item.title },
  };
}

export function usePlanActivity({
  projectId,
  compact,
  responding,
}: {
  projectId: string;
  compact: boolean;
  responding: boolean;
}) {
  const localize = useDesignLocalize();
  const { data: plan } = usePlanQuery(projectId, { responding });
  const [panel, setPanel] = useAtom(workspacePanelAtom);
  const mode = useAtomValue(workspaceModeAtom);
  const previous = useRef<DesignPlan | null | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (plan === undefined) {
      return;
    }
    const before = previous.current;
    previous.current = plan;
    if (before === undefined || !plan) {
      return;
    }
    const message = planAnnouncementKey(before, plan);
    if (message) {
      setAnnouncement(localize(message.key, message.options));
    }
    const isNew = !before || before.planId !== plan.planId;
    if (isNew && !compact && panel === null && !modeExtension(mode).Panel) {
      setPanel('plan');
    }
  }, [compact, localize, mode, panel, plan, setPanel]);

  return announcement;
}
