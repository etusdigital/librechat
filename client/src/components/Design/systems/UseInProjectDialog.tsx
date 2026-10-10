import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@librechat/client';
import { useNavigate } from 'react-router-dom';
import type { DesignSystemSummary } from '../api/types';
import { useDesignProjectQuery, useUpdateDesignProjectMutation } from '../api/queries';
import { designErrorMessageKey } from '../api/errors';
import { designApplySystemPath } from '../paths';
import { useDesignLocalize } from '../i18n';
import ActionDialog from './ActionDialog';

export default function UseInProjectDialog({
  system,
  projectId,
}: {
  system: DesignSystemSummary;
  projectId: string;
}) {
  const localize = useDesignLocalize();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: project } = useDesignProjectQuery(projectId);
  const mutation = useUpdateDesignProjectMutation(projectId);

  if (!project) {
    return null;
  }
  const names = { system: system.name, project: project.name };

  if (!project.canWrite) {
    return (
      <p className="text-sm text-text-secondary">
        {localize('systems.project_read_only', { project: project.name })}
      </p>
    );
  }

  const onOpenChange = (next: boolean) => {
    if (mutation.isLoading) {
      return;
    }
    setOpen(next);
    if (!next) {
      mutation.reset();
    }
  };

  if (project.designSystemId === system.id && !open) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-status-success-border bg-status-success-subtle px-3 py-2 text-sm font-medium text-text-primary">
        <Check className="size-4" aria-hidden="true" />
        {localize('systems.in_project')}
      </span>
    );
  }

  const errorKey = designErrorMessageKey(mutation.error);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {localize('systems.use_in_project')}
      </Button>
      <ActionDialog
        open={open}
        onOpenChange={onOpenChange}
        title={
          mutation.isSuccess
            ? localize('systems.use_in_project_done', names)
            : localize('systems.use_in_project_title', names)
        }
        description={localize('systems.use_in_project_body')}
        error={
          mutation.isError
            ? localize(errorKey === 'error_generic' ? 'systems.use_in_project_error' : errorKey)
            : null
        }
        footer={
          mutation.isSuccess ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {localize('systems.close')}
              </Button>
              <Button
                type="button"
                onClick={() => navigate(designApplySystemPath(projectId, system.id))}
              >
                {localize('systems.ask_agent')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isLoading}
                onClick={() => onOpenChange(false)}
              >
                {localize('systems.cancel')}
              </Button>
              <Button
                type="button"
                disabled={mutation.isLoading}
                onClick={() => mutation.mutate({ designSystemId: system.id })}
              >
                {localize('systems.use_in_project')}
              </Button>
            </>
          )
        }
      />
    </>
  );
}
