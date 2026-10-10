import type { LucideIcon } from 'lucide-react';
import type { DesignSystemSummary } from '../api/types';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

const MAX_SWATCHES = 5;

export function swatchesOf(system: DesignSystemSummary | undefined) {
  return (system?.swatches ?? []).slice(0, MAX_SWATCHES);
}

export function SwatchDots({
  system,
  className,
}: {
  system: DesignSystemSummary | undefined;
  className?: string;
}) {
  const swatches = swatchesOf(system);
  if (swatches.length === 0) {
    return null;
  }
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 -space-x-1', className ?? '')}>
      {swatches.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="size-3.5 rounded-full border border-border-light"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

export function SwatchArt({
  system,
  icon: Icon,
}: {
  system: DesignSystemSummary | undefined;
  icon: LucideIcon;
}) {
  const localize = useDesignLocalize();
  const swatches = swatchesOf(system);
  return (
    <div className="flex h-full w-full flex-col">
      {swatches.length > 0 ? (
        <div className="flex h-1/3 w-full">
          {swatches.map((color, index) => (
            <span
              key={`${color}-${index}`}
              className="h-full flex-1"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-1 items-center justify-center text-text-secondary">
        <Icon className="size-8" strokeWidth={1.5} />
        {system?.headingFont ? (
          <span
            className="ml-2 text-2xl font-semibold text-text-primary"
            style={{ fontFamily: system.headingFont }}
          >
            {localize('home.system_specimen')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function DesignSystemBadge({
  systemId,
  system,
}: {
  systemId: string;
  system: DesignSystemSummary | undefined;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border-light px-2 py-0.5 text-xs text-text-secondary">
      <SwatchDots system={system} />
      <span className="truncate">{system?.name ?? systemId}</span>
    </span>
  );
}
