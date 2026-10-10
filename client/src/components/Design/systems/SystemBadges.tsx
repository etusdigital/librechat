import { Building2, Sparkles, Star } from 'lucide-react';
import type { DesignSystemSummary } from '../api/types';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

export interface SystemDefaults {
  personal: string | null;
  company: string | null;
}

const BADGE =
  'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium';

export default function SystemBadges({
  system,
  defaults,
  className,
}: {
  system: Pick<DesignSystemSummary, 'id' | 'inspiredBy'>;
  defaults: SystemDefaults;
  className?: string;
}) {
  const localize = useDesignLocalize();
  const isCompanyDefault = defaults.company === system.id;
  const isPersonalDefault = !isCompanyDefault && defaults.personal === system.id;

  if (!isCompanyDefault && !isPersonalDefault && !system.inspiredBy) {
    return null;
  }
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {isCompanyDefault ? (
        <span className={cn(BADGE, 'border-transparent bg-surface-inverted text-text-inverted')}>
          <Building2 className="size-3 shrink-0" aria-hidden="true" />
          {localize('systems.badge_company_default')}
        </span>
      ) : null}
      {isPersonalDefault ? (
        <span className={cn(BADGE, 'border-border-heavy bg-surface-primary text-text-primary')}>
          <Star className="size-3 shrink-0" aria-hidden="true" />
          {localize('systems.badge_default')}
        </span>
      ) : null}
      {system.inspiredBy ? (
        <span className={cn(BADGE, 'border-border-medium bg-surface-primary text-text-secondary')}>
          <Sparkles className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {localize('systems.badge_inspired', { brand: system.inspiredBy })}
          </span>
        </span>
      ) : null}
    </span>
  );
}
