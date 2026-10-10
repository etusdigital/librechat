import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@librechat/client';
import type { ReactNode } from 'react';
import { useDesignLocalize } from '../i18n';

export function DesignCardsSkeleton({ label, count = 6 }: { label: string; count?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            className="flex min-h-[7.5rem] flex-col rounded-2xl bg-surface-secondary p-4"
          >
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/3" />
            <Skeleton className="mt-auto h-3 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DesignErrorState({
  message,
  onRetry,
  action,
  icon = AlertTriangle,
}: {
  message: string;
  onRetry?: () => void;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  const localize = useDesignLocalize();
  return (
    <div role="alert" className="flex flex-1 flex-col">
      <EmptyState
        icon={icon}
        description={message}
        className="flex-1 rounded-2xl bg-surface-secondary px-6 py-16"
        action={
          action ??
          (onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {localize('retry')}
            </Button>
          ) : undefined)
        }
      />
    </div>
  );
}

export function DesignEmptyState({ icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <EmptyState
      icon={icon}
      description={message}
      className="flex-1 rounded-2xl bg-surface-secondary px-6 py-16"
    />
  );
}
