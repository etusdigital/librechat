import { useCallback, useMemo } from 'react';
import { Button } from '@librechat/client';
import { Palette, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DesignMe, DesignTemplate, ProjectScope } from '../api/types';
import {
  NEW_PROJECT_PARAMS,
  isNewProjectKind,
  readNewProjectPreset,
  withoutNewProjectParams,
  type NewProjectPreset,
} from './new-project';
import ProjectScopeTabs, { isProjectScope, scopePanelId, scopeTabId } from './ProjectScopeTabs';
import { useDesignSystemDirectory } from '../api/home-queries';
import DesignAccessGate from '../common/DesignAccessGate';
import NewProjectDialog from './NewProjectDialog';
import TemplateGallery from './TemplateGallery';
import { DESIGN_SYSTEMS_PATH } from '../paths';
import DesignPage from '../common/DesignPage';
import { useDesignAccess } from '../access';
import { useDesignLocalize } from '../i18n';
import ProjectGrid from './ProjectGrid';

const TAB_PARAM = 'tab';

function presetParams(search: URLSearchParams, preset: NewProjectPreset) {
  const next = withoutNewProjectParams(search);
  next.set(NEW_PROJECT_PARAMS.open, '1');
  if (preset.kind) {
    next.set(NEW_PROJECT_PARAMS.kind, preset.kind);
  }
  if (preset.templateId) {
    next.set(NEW_PROJECT_PARAMS.template, preset.templateId);
  }
  if (preset.designSystemId) {
    next.set(NEW_PROJECT_PARAMS.system, preset.designSystemId);
  }
  return next;
}

function HomeContent({ me }: { me: DesignMe }) {
  const localize = useDesignLocalize();
  const [search, setSearch] = useSearchParams();
  const directory = useDesignSystemDirectory();
  const rawTab = search.get(TAB_PARAM);
  const scope: ProjectScope = isProjectScope(rawTab) ? rawTab : 'mine';
  const preset = useMemo(() => readNewProjectPreset(search), [search]);

  const openNewProject = useCallback(
    (next: NewProjectPreset = {}) => setSearch(presetParams(search, next), { replace: true }),
    [search, setSearch],
  );
  const closeNewProject = useCallback(
    () => setSearch(withoutNewProjectParams(search), { replace: true }),
    [search, setSearch],
  );
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
    openNewProject(
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
          to={DESIGN_SYSTEMS_PATH}
          className="inline-flex min-h-10 items-center gap-3 rounded-xl border border-border-light bg-surface-secondary px-3 py-2 text-sm text-text-primary no-underline transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <Palette className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-medium">{localize('home_systems_shortcut')}</span>
            <span className="text-xs text-text-secondary">
              {localize('home_systems_shortcut_description')}
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
                  {localize('home_templates_heading')}
                </h3>
                <TemplateGallery
                  label={localize('home_templates_heading')}
                  onSelect={startFromTemplate}
                />
              </div>
            ) : null
          }
        />
      </div>
      <NewProjectDialog
        open={preset !== null}
        onOpenChange={(open) => (open ? openNewProject() : closeNewProject())}
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
      onClick={() => setSearch(presetParams(search, {}), { replace: true })}
    >
      <Plus className="size-4" aria-hidden="true" />
      {localize('home_new_project')}
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
