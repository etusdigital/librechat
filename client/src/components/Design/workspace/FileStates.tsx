import { Skeleton } from '@librechat/client';
import { DesignErrorState } from '../common/DesignStates';
import { designErrorMessageKey } from '../api/errors';
import { useDesignLocalize } from '../i18n';

export function FileLoading() {
  const localize = useDesignLocalize();
  return (
    <div role="status" className="flex flex-1 flex-col gap-2 p-4">
      <span className="sr-only">{localize('workspace.file.loading')}</span>
      {[80, 65, 72, 40, 58].map((width) => (
        <Skeleton key={width} className="h-4" style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

export function FileError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const localize = useDesignLocalize();
  const key = designErrorMessageKey(error);
  return (
    <div className="flex flex-1 p-4">
      <DesignErrorState
        message={localize(key === 'error_generic' ? 'workspace.file.error' : key)}
        onRetry={onRetry}
      />
    </div>
  );
}
