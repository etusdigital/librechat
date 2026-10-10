import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@librechat/client';
import { Building2, FolderPlus, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DesignProject, DesignSystemSummary, ProjectScope } from '../api/types';
import { DesignCardsSkeleton, DesignEmptyState, DesignErrorState } from '../common/DesignStates';
import { designErrorCode, designErrorMessageKey } from '../api/errors';
import { PROJECT_KIND_KEYS, formatDesignDate } from '../common/format';
import { useDesignLocalize, type DesignTranslationKey } from '../i18n';
import { DesignSystemBadge, SwatchArt } from './SystemSwatches';
import { useProjectThumbnailQuery } from '../api/home-queries';
import { useDesignProjectsQuery } from '../api/queries';
import { PROJECT_KIND_ICONS } from './kind-icons';
import FrameThumbnail from './FrameThumbnail';
import { designProjectPath } from '../paths';
import { useInView } from './use-in-view';

const EMPTY: Record<ProjectScope, { icon: LucideIcon; key: DesignTranslationKey }> = {
  mine: { icon: FolderPlus, key: 'home_empty' },
  shared: { icon: Users, key: 'home_empty_shared' },
  company: { icon: Building2, key: 'home_empty_company' },
};

function ProjectThumbnail({
  project,
  system,
}: {
  project: DesignProject;
  system: DesignSystemSummary | undefined;
}) {
  const localize = useDesignLocalize();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const { data: src } = useProjectThumbnailQuery(project, inView);
  return (
    <div ref={ref}>
      <FrameThumbnail
        src={src ?? null}
        title={localize('home_thumbnail_title', { name: project.name })}
        fallback={<SwatchArt system={system} icon={PROJECT_KIND_ICONS[project.kind]} />}
      />
    </div>
  );
}

export function ProjectCard({
  project,
  system,
  showOwner,
}: {
  project: DesignProject;
  system: DesignSystemSummary | undefined;
  showOwner: boolean;
}) {
  const localize = useDesignLocalize();
  const updated = formatDesignDate(project.updatedAt);
  const kind = localize(PROJECT_KIND_KEYS[project.kind] ?? 'project_kind_other');
  return (
    <li className="min-w-0">
      <Link
        to={designProjectPath(project.projectId)}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-secondary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        <ProjectThumbnail project={project} system={system} />
        <span className="flex min-w-0 flex-1 flex-col gap-1 border-t border-border-light p-4">
          <span className="truncate text-base font-semibold tracking-tight text-text-primary">
            {project.name}
          </span>
          <span className="truncate text-sm text-text-secondary">
            {updated ? `${kind} · ${localize('project_updated_at', { date: updated })}` : kind}
          </span>
          {showOwner ? (
            <span className="truncate text-xs text-text-secondary">
              {localize('home_project_owner', { name: project.owner.name })}
            </span>
          ) : null}
          <span className="mt-auto flex min-w-0 pt-2">
            <DesignSystemBadge systemId={project.designSystemId} system={system} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function ProjectGrid({
  scope,
  directory,
  emptyAction,
}: {
  scope: ProjectScope;
  directory: Map<string, DesignSystemSummary>;
  emptyAction?: ReactNode;
}) {
  const localize = useDesignLocalize();
  const { data, error, isLoading, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useDesignProjectsQuery({ scope });
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
    const empty = EMPTY[scope];
    return (
      <div className="flex flex-col gap-6">
        <DesignEmptyState icon={empty.icon} message={localize(empty.key)} />
        {emptyAction}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ul
        aria-label={localize('home_projects_label')}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {projects.map((project) => (
          <ProjectCard
            key={project.projectId}
            project={project}
            system={directory.get(project.designSystemId)}
            showOwner={scope !== 'mine'}
          />
        ))}
      </ul>
      {hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={isFetchingNextPage}
          onClick={() => {
            fetchNextPage();
          }}
        >
          {localize(isFetchingNextPage ? 'loading' : 'home_load_more')}
        </Button>
      ) : null}
    </div>
  );
}
