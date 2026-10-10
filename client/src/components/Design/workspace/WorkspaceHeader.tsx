import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Palette, Pencil, X } from 'lucide-react';
import { Input, Spinner, useToastContext } from '@librechat/client';
import type { FormEvent, KeyboardEvent } from 'react';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import type { DeviceId } from '../state/atoms';
import { useDesignSystemQuery, useUpdateDesignProjectMutation } from '../api/queries';
import WorkspaceHeaderActions from './header/WorkspaceHeaderActions';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { DESIGN_HOME_PATH, designSystemPath } from '../paths';
import { designErrorMessageKey } from '../api/errors';
import { NotificationSeverity } from '~/common';
import { useDesignLocalize } from '../i18n';

const NAME_MAX = 120;

const iconButton =
  'flex size-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary';

function ProjectName({ project }: { project: DesignProjectDetail }) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateDesignProjectMutation(project.projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    setDraft(project.name);
    setEditing(true);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const name = draft.trim();
    if (!name || name === project.name) {
      setEditing(false);
      return;
    }
    update.mutate(
      { name },
      {
        onSuccess: () => setEditing(false),
        onError: (error) =>
          showToast({
            message: localize(
              designErrorMessageKey(error) === 'error_generic'
                ? 'workspace.header.rename_error'
                : designErrorMessageKey(error),
            ),
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          }),
      },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          ref={inputRef}
          value={draft}
          maxLength={NAME_MAX}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label={localize('workspace.header.name_label')}
          className="h-9 min-w-0 flex-1 text-base font-semibold"
          disabled={update.isLoading}
        />
        <button
          type="submit"
          className={iconButton}
          aria-label={localize('workspace.header.rename_save')}
          disabled={update.isLoading}
        >
          {update.isLoading ? <Spinner className="size-4" /> : <Check className="size-4" />}
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={localize('workspace.header.rename_cancel')}
          onClick={() => setEditing(false)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="truncate text-base font-semibold tracking-tight text-text-primary md:text-lg">
        {project.name}
      </h1>
      {project.canWrite ? (
        <button
          type="button"
          className={iconButton}
          aria-label={localize('workspace.header.rename')}
          onClick={start}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function DesignSystemChip({ systemId }: { systemId: string }) {
  const localize = useDesignLocalize();
  const { data } = useDesignSystemQuery(systemId);
  const name = data?.name ?? systemId;
  return (
    <Link
      to={designSystemPath(systemId)}
      aria-label={localize('workspace.header.design_system', { name })}
      title={localize('workspace.header.design_system', { name })}
      className="hidden min-w-0 max-w-[12rem] items-center gap-1.5 rounded-full border border-border-light px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary sm:flex"
    >
      <Palette className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </Link>
  );
}

export default function WorkspaceHeader({
  project,
  me,
  activePath,
  device,
  compact,
}: {
  project: DesignProjectDetail;
  me: DesignMe;
  activePath: string;
  device: DeviceId;
  compact: boolean;
}) {
  const localize = useDesignLocalize();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-light bg-presentation px-2 md:px-3">
      {compact ? <OpenSidebar className="size-9 shrink-0" /> : null}
      <Link to={DESIGN_HOME_PATH} aria-label={localize('project_back')} className={iconButton}>
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ProjectName key={project.name} project={project} />
        <DesignSystemChip systemId={project.designSystemId} />
      </div>
      <div className="flex shrink-0 items-center gap-1" data-testid="design-workspace-actions">
        <WorkspaceHeaderActions
          project={project}
          me={me}
          activePath={activePath}
          device={device}
          compact={compact}
        />
      </div>
    </header>
  );
}
