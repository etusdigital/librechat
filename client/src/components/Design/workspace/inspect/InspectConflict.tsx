import { AlertTriangle } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import { useDesignLocalize } from '../../i18n';

export default function InspectConflict({
  busy,
  onReload,
  onApplyOverLatest,
}: {
  busy: boolean;
  onReload: () => void;
  onApplyOverLatest: () => void;
}) {
  const localize = useDesignLocalize();
  return (
    <div
      role="alert"
      data-testid="inspect-conflict"
      className="flex flex-col gap-3 rounded-lg border border-border-medium p-3"
    >
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-text-warning" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text-primary">
            {localize('inspect.conflict_title')}
          </p>
          <p className="text-xs text-text-secondary">{localize('inspect.conflict_description')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onReload}>
          {localize('inspect.conflict_reload')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-busy={busy}
          onClick={onApplyOverLatest}
        >
          {busy ? <Spinner className="size-4" /> : null}
          {localize('inspect.conflict_apply')}
        </Button>
      </div>
    </div>
  );
}
