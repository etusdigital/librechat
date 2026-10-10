import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FolderPlus } from 'lucide-react';
import type { DesignProject } from '../api/types';
import { DesignCardsSkeleton, DesignEmptyState, DesignErrorState } from '../common/DesignStates';
import { designErrorCode, designErrorMessageKey } from '../api/errors';
import { PROJECT_KIND_KEYS, formatDesignDate } from '../common/format';
import DesignAccessGate from '../common/DesignAccessGate';
import { useDesignProjectsQuery } from '../api/queries';
import DesignPage from '../common/DesignPage';
import { designProjectPath } from '../paths';
import { useDesignLocalize } from '../i18n';

function ProjectCard({ project }: { project: DesignProject }) {
  const localize = useDesignLocalize();
  const updated = formatDesignDate(project.updatedAt);
  return (
    <li>
      <Link
        to={designProjectPath(project.projectId)}
        className="flex min-h-[7.5rem] flex-col rounded-2xl border border-border-light bg-surface-secondary p-4 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
      >
        <span className="truncate text-base font-semibold tracking-tight text-text-primary">
          {project.name}
        </span>
        <span className="mt-1 text-sm text-text-secondary">
          {localize(PROJECT_KIND_KEYS[project.kind] ?? 'project_kind_other')}
        </span>
        {updated ? (
          <span className="mt-auto pt-4 text-xs tabular-nums text-text-secondary">
            {localize('project_updated_at', { date: updated })}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function MyProjects() {
  const localize = useDesignLocalize();
  const { data, error, isLoading, refetch } = useDesignProjectsQuery({ scope: 'mine' });
  const projects = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data?.pages]);

  if (isLoading) {
    return <DesignCardsSkeleton label={localize('loading')} />;
  }
  if (error) {
    const key = designErrorMessageKey(error);
    const generic = key === 'error_generic' || designErrorCode(error) === null;
    return (
      <DesignErrorState
        message={localize(generic ? 'home_projects_error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  }
  if (projects.length === 0) {
    return <DesignEmptyState icon={FolderPlus} message={localize('home_empty')} />;
  }
  return (
    <ul
      aria-label={localize('home_projects_label')}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {projects.map((project) => (
        <ProjectCard key={project.projectId} project={project} />
      ))}
    </ul>
  );
}

export default function DesignHomePage() {
  const localize = useDesignLocalize();
  return (
    <DesignPage title={localize('home_title')}>
      <DesignAccessGate>
        {() => (
          <section className="flex flex-1 flex-col gap-4">
            <h2 className="text-sm font-medium text-text-primary">
              {localize('home_projects_heading')}
            </h2>
            <MyProjects />
          </section>
        )}
      </DesignAccessGate>
    </DesignPage>
  );
}
