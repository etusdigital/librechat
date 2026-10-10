import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { DesignSystemSummary } from '../api/types';
import SystemBadges, { type SystemDefaults } from './SystemBadges';
import SystemThumbnail from './SystemThumbnail';
import { cn } from '~/utils';

export default function DesignSystemCard({
  system,
  to,
  defaults,
  featured = false,
}: {
  system: DesignSystemSummary;
  to: string;
  defaults: SystemDefaults;
  featured?: boolean;
}) {
  const nameId = useId();
  const detailsId = useId();
  return (
    <li className="min-w-0">
      <Link
        to={to}
        aria-labelledby={nameId}
        aria-describedby={detailsId}
        data-system-id={system.id}
        className={cn(
          'group flex h-full flex-col overflow-hidden rounded-2xl border bg-surface-secondary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-presentation',
          featured ? 'border-border-heavy md:flex-row' : 'border-border-light',
        )}
      >
        <div
          className={cn('shrink-0', featured ? 'md:w-1/2 md:border-r md:border-border-light' : '')}
        >
          <SystemThumbnail system={system} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 md:p-4">
          <span
            id={nameId}
            className={cn(
              'truncate font-semibold tracking-tight text-text-primary',
              featured ? 'text-lg' : 'text-base',
            )}
          >
            {system.name}
          </span>
          <span id={detailsId} className="flex min-w-0 flex-col gap-1.5">
            <span className="truncate text-sm text-text-secondary">{system.category}</span>
            {featured && system.summary ? (
              <span className="line-clamp-3 text-sm text-text-secondary">{system.summary}</span>
            ) : null}
            <SystemBadges system={system} defaults={defaults} />
          </span>
        </div>
      </Link>
    </li>
  );
}
