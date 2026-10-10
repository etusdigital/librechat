import { useRef, type KeyboardEvent } from 'react';
import type { ProjectScope } from '../api/types';
import { useDesignLocalize, type DesignTranslationKey } from '../i18n';
import { cn } from '~/utils';

export const PROJECT_SCOPES: readonly ProjectScope[] = ['mine', 'shared', 'company'];

const SCOPE_KEYS: Record<ProjectScope, DesignTranslationKey> = {
  mine: 'home_tab_mine',
  shared: 'home_tab_shared',
  company: 'home_tab_company',
};

export const scopeTabId = (scope: ProjectScope) => `design-home-tab-${scope}`;
export const scopePanelId = (scope: ProjectScope) => `design-home-panel-${scope}`;

export function isProjectScope(value: unknown): value is ProjectScope {
  return PROJECT_SCOPES.includes(value as ProjectScope);
}

export default function ProjectScopeTabs({
  value,
  onChange,
}: {
  value: ProjectScope;
  onChange: (scope: ProjectScope) => void;
}) {
  const localize = useDesignLocalize();
  const refs = useRef<Partial<Record<ProjectScope, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = PROJECT_SCOPES.indexOf(value);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: PROJECT_SCOPES.length - 1,
    };
    if (!(event.key in moves)) {
      return;
    }
    event.preventDefault();
    const next = PROJECT_SCOPES[(moves[event.key] + PROJECT_SCOPES.length) % PROJECT_SCOPES.length];
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={localize('home_tabs_label')}
      onKeyDown={onKeyDown}
      className="-mx-1 flex gap-1 overflow-x-auto border-b border-border-light px-1"
    >
      {PROJECT_SCOPES.map((scope) => {
        const selected = scope === value;
        return (
          <button
            key={scope}
            ref={(node) => {
              refs.current[scope] = node;
            }}
            id={scopeTabId(scope)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={scopePanelId(scope)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(scope)}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary',
              selected
                ? 'border-text-primary font-semibold text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {localize(SCOPE_KEYS[scope])}
          </button>
        );
      })}
    </div>
  );
}
