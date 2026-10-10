import { useParams } from 'react-router-dom';
import { Construction, SearchX } from 'lucide-react';
import { DesignCardsSkeleton, DesignEmptyState, DesignErrorState } from '../common/DesignStates';
import { designErrorCode, designErrorMessageKey, isDesignApiError } from '../api/errors';
import DesignAccessGate from '../common/DesignAccessGate';
import { useDesignProjectQuery } from '../api/queries';
import DesignPage from '../common/DesignPage';
import { useDesignLocalize } from '../i18n';
import { DESIGN_HOME_PATH } from '../paths';

function ProjectBody({ projectId }: { projectId: string }) {
  const localize = useDesignLocalize();
  const { data: project, error, isLoading, refetch } = useDesignProjectQuery(projectId);

  if (isLoading) {
    return <DesignCardsSkeleton label={localize('loading')} count={2} />;
  }
  if (error) {
    if (
      isDesignApiError(error) &&
      error.status === 404 &&
      designErrorCode(error) !== 'design_disabled'
    ) {
      return <DesignErrorState icon={SearchX} message={localize('project_not_found')} />;
    }
    const key = designErrorMessageKey(error);
    return (
      <DesignErrorState
        message={localize(key === 'error_generic' ? 'project_error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  }
  if (!project) {
    return null;
  }
  return (
    <section aria-labelledby="design-project-name" className="flex flex-1 flex-col gap-4">
      <h2 id="design-project-name" className="truncate text-base font-semibold text-text-primary">
        {project.name}
      </h2>
      <DesignEmptyState icon={Construction} message={localize('workspace_soon')} />
    </section>
  );
}

export default function DesignWorkspacePage() {
  const localize = useDesignLocalize();
  const { projectId = '' } = useParams();
  return (
    <DesignPage
      title={localize('project_title_fallback')}
      back={{ to: DESIGN_HOME_PATH, label: localize('project_back') }}
    >
      <DesignAccessGate>{() => <ProjectBody projectId={projectId} />}</DesignAccessGate>
    </DesignPage>
  );
}
