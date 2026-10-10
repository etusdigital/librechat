import { useEffect, useMemo, useState } from 'react';
import { Button } from '@librechat/client';
import { Palette, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DesignMe, DesignTemplate, ProjectScope } from '../api/types';
import {
  isNewProjectKind,
  readNewProjectPreset,
  withoutNewProjectParams,
  type NewProjectPreset,
} from './new-project';
import ProjectScopeTabs, { isProjectScope, scopePanelId, scopeTabId } from './ProjectScopeTabs';
import { useDesignSystemDirectory } from '../api/home-queries';
import { DESIGN_QUERY, designSystemsPath } from '../paths';
import DesignAccessGate from '../common/DesignAccessGate';
import NewProjectDialog from './NewProjectDialog';
import TemplateGallery from './TemplateGallery';
import DesignPage from '../common/DesignPage';
import { useDesignAccess } from '../access';
import { useDesignLocalize } from '../i18n';
import ProjectGrid from './ProjectGrid';

const TAB_PARAM = 'tab';

function HomeContent({ me }: { me: DesignMe }) {
  const localize = useDesignLocalize();
  const [search, setSearch] = useSearchParams();
  const directory = useDesignSystemDirectory();
  const rawTab = search.get(TAB_PARAM);
  const scope: ProjectScope = isProjectScope(rawTab) ? rawTab : 'mine';
  const requested = useMemo(() => readNewProjectPreset(search), [search]);
  const [preset, setPreset] = useState<NewProjectPreset | null>(null);

  useEffect(() => {
    if (requested) {
      setPreset(requested);
      setSearch(withoutNewProjectParams(search), { replace: true });
    }
  }, [requested, search, setSearch]);

  const changeScope = (next: ProjectScope) => {
    const params = new URLSearchParams(search);
    if (next === 'mine') {
      params.delete(TAB_PARAM);
    } else {
      params.set(TAB_PARAM, next);
    }
    setSearch(params, { replace: true });
  };

  const startFromTemplate = (template: DesignTemplate | null) =>
    setPreset(
      template
        ? {
            templateId: template.id,
            ...(isNewProjectKind(template.kind) ? { kind: template.kind } : {}),
          }
        : {},
    );

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="sr-only">{localize('home_projects_heading')}</h2>
        <Link
          to={designSystemsPath()}
          className="inline-flex min-h-10 items-center gap-3 rounded-xl border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary no-underline transition-colors hover:bg-surface-secondary-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <Palette className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-medium">{localize('home.systems_shortcut')}</span>
            <span className="text-xs text-text-secondary">
              {localize('home.systems_shortcut_description')}
            </span>
          </span>
        </Link>
      </div>
      <ProjectScopeTabs value={scope} onChange={changeScope} />
      <div
        role="tabpanel"
        id={scopePanelId(scope)}
        aria-labelledby={scopeTabId(scope)}
        className="flex flex-1 flex-col"
      >
        <ProjectGrid
          key={scope}
          scope={scope}
          directory={directory}
          emptyAction={
            scope === 'mine' ? (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-text-primary">
                  {localize('home.templates_heading')}
                </h3>
                <TemplateGallery
                  label={localize('home.templates_heading')}
                  onSelect={startFromTemplate}
                />
              </div>
            ) : null
          }
        />
      </div>
      <NewProjectDialog
        open={preset !== null}
        onOpenChange={(open) => setPreset(open ? (preset ?? {}) : null)}
        me={me}
        preset={preset ?? {}}
      />
    </section>
  );
}

function NewProjectButton() {
  const localize = useDesignLocalize();
  const [search, setSearch] = useSearchParams();
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => {
        const params = new URLSearchParams(search);
        params.set(DESIGN_QUERY.newProject, '1');
        setSearch(params, { replace: true });
      }}
    >
      <Plus className="size-4" aria-hidden="true" />
      {localize('home.new_project')}
    </Button>
  );
}

export default function DesignHomePage() {
  const localize = useDesignLocalize();
  const { access } = useDesignAccess();
  return (
    <DesignPage
      title={localize('home_title')}
      actions={access.status === 'granted' ? <NewProjectButton /> : null}
    >
      <DesignAccessGate>{(me) => <HomeContent me={me} />}</DesignAccessGate>
    </DesignPage>
  );
}
