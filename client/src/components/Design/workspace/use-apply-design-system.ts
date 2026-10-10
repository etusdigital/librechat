import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDesignSystemQuery } from '../api/queries';
import { useDesignLocalize } from '../i18n';
import { DESIGN_QUERY } from '../paths';

export function useApplyDesignSystemRequest() {
  const localize = useDesignLocalize();
  const [searchParams, setSearchParams] = useSearchParams();
  const systemId = searchParams.get(DESIGN_QUERY.applyDesignSystem) ?? '';
  const system = useDesignSystemQuery(systemId);
  const [composerText, setComposerText] = useState<string | null>(null);

  useEffect(() => {
    if (!systemId || system.isFetching) {
      return;
    }
    const name = system.data?.name ?? systemId;
    setComposerText(localize('workspace.chat.apply_design_system', { name }));
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(DESIGN_QUERY.applyDesignSystem);
        return next;
      },
      { replace: true },
    );
  }, [localize, setSearchParams, system.data?.name, system.isFetching, systemId]);

  const clearComposerText = useCallback(() => setComposerText(null), []);
  return { composerText, clearComposerText };
}
