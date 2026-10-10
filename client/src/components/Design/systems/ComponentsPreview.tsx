import { useId, useMemo, useState } from 'react';
import { ExternalLink, LayoutTemplate } from 'lucide-react';
import type { DesignSystemDetail } from '../api/types';
import { DesignEmptyState } from '../common/DesignStates';
import { useDesignLocalize } from '../i18n';
import { safeHttpUrl } from './urls';

export const COMPONENTS_SANDBOX = 'allow-scripts';

export default function ComponentsPreview({ system }: { system: DesignSystemDetail }) {
  const localize = useDesignLocalize();
  const selectId = useId();
  const pages = useMemo(() => {
    const componentsUrl = safeHttpUrl(system.componentsUrl);
    if (!componentsUrl) {
      return [];
    }
    const extra = system.previews
      .map((page) => ({ title: page.title || page.role, url: safeHttpUrl(page.url) }))
      .filter((page): page is { title: string; url: string } => Boolean(page.url))
      .filter((page) => page.url !== componentsUrl);
    return [{ title: localize('systems.components_heading'), url: componentsUrl }, ...extra];
  }, [system.componentsUrl, system.previews, localize]);
  const [selected, setSelected] = useState(0);

  if (pages.length === 0) {
    return <DesignEmptyState icon={LayoutTemplate} message={localize('systems.components_none')} />;
  }
  const page = pages[Math.min(selected, pages.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        {pages.length > 1 ? (
          <div className="flex flex-col gap-1.5 sm:w-72">
            <label htmlFor={selectId} className="text-sm font-medium text-text-primary">
              {localize('systems.components_page')}
            </label>
            <select
              id={selectId}
              value={selected}
              onChange={(event) => setSelected(Number(event.target.value))}
              className="h-10 w-full min-w-0 rounded-lg border border-border-light bg-surface-primary px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              {pages.map((option, index) => (
                <option key={option.url} value={index}>
                  {option.title}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span />
        )}
        <a
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-medium text-text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary sm:self-auto"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {localize('systems.components_open')}
        </a>
      </div>
      <iframe
        key={page.url}
        src={page.url}
        title={localize('systems.components_frame_title', { name: system.name })}
        sandbox={COMPONENTS_SANDBOX}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-[70vh] min-h-[24rem] w-full rounded-2xl border border-border-light bg-surface-primary"
      />
    </div>
  );
}
