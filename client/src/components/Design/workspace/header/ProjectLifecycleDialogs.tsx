import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { FormEvent } from 'react';
import type { DesignTranslationKey } from '../../i18n';
import type { DesignProject } from '../../api/types';
import { useDeleteProjectMutation, useDuplicateProjectMutation } from '../../api/workspace-queries';
import { DESIGN_HOME_PATH, designProjectPath } from '../../paths';
import { designErrorMessageKey } from '../../api/errors';
import { NotificationSeverity } from '~/common';
import { useDesignLocalize } from '../../i18n';

export type ProjectLifecycleDialog = 'duplicate' | 'delete';

const NAME_MAX = 120;

function useErrorToast(fallback: DesignTranslationKey) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  return (error: unknown) => {
    const key = designErrorMessageKey(error);
    showToast({
      message: localize(key === 'error_generic' ? fallback : key),
      severity: NotificationSeverity.ERROR,
      showIcon: true,
    });
  };
}

export function DuplicateProjectDialog({
  project,
  onClose,
}: {
  project: DesignProject;
  onClose: () => void;
}) {
  const localize = useDesignLocalize();
  const navigate = useNavigate();
  const duplicate = useDuplicateProjectMutation(project.projectId);
  const onError = useErrorToast('workspace.header.duplicate_error');
  const [name, setName] = useState(() =>
    localize('workspace.header.duplicate_default', { name: project.name }).slice(0, NAME_MAX),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    duplicate.mutate(trimmed, {
      onSuccess: (copy) => {
        onClose();
        navigate(designProjectPath(copy.projectId));
      },
      onError,
    });
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{localize('workspace.header.duplicate_title')}</OGDialogTitle>
          <OGDialogDescription>
            {localize('workspace.header.duplicate_description')}
          </OGDialogDescription>
        </OGDialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            value={name}
            maxLength={NAME_MAX}
            onChange={(event) => setName(event.target.value)}
            aria-label={localize('workspace.header.duplicate_name')}
            disabled={duplicate.isLoading}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <OGDialogClose asChild>
              <Button type="button" variant="outline" disabled={duplicate.isLoading}>
                {localize('workspace.cancel')}
              </Button>
            </OGDialogClose>
            <Button type="submit" disabled={duplicate.isLoading || !name.trim()}>
              {duplicate.isLoading ? <Spinner className="size-4" /> : null}
              {localize('workspace.header.duplicate_confirm')}
            </Button>
          </div>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
}

export function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: DesignProject;
  onClose: () => void;
}) {
  const localize = useDesignLocalize();
  const navigate = useNavigate();
  const remove = useDeleteProjectMutation(project.projectId);
  const onError = useErrorToast('workspace.header.delete_error');
  const [typed, setTyped] = useState('');
  const matches = typed === project.name;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!matches) {
      return;
    }
    remove.mutate(typed, {
      onSuccess: () => {
        onClose();
        navigate(DESIGN_HOME_PATH, { replace: true });
      },
      onError,
    });
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{localize('workspace.header.delete_title')}</OGDialogTitle>
          <OGDialogDescription>
            {localize('workspace.header.delete_description', { name: project.name })}
          </OGDialogDescription>
        </OGDialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label={localize('workspace.header.delete_name')}
            autoComplete="off"
            disabled={remove.isLoading}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <OGDialogClose asChild>
              <Button type="button" variant="outline" disabled={remove.isLoading}>
                {localize('workspace.cancel')}
              </Button>
            </OGDialogClose>
            <Button type="submit" variant="destructive" disabled={remove.isLoading || !matches}>
              {remove.isLoading ? <Spinner className="size-4" /> : null}
              {localize('workspace.header.delete_confirm')}
            </Button>
          </div>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
}
