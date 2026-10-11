import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Pencil, X } from 'lucide-react';
import { Input, Spinner, useToastContext } from '@librechat/client';
import type { FormEvent, KeyboardEvent } from 'react';
import type { DesignProjectDetail } from '../api/types';
import type { DeviceId } from '../state/atoms';
import WorkspaceHeaderActions from './header/WorkspaceHeaderActions';
import { useUpdateDesignProjectMutation } from '../api/queries';
import DesignSystemControl from './header/DesignSystemControl';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import ChatSidebarToggle from './header/ChatSidebarToggle';
import { designErrorMessageKey } from '../api/errors';
import { NotificationSeverity } from '~/common';
import { DESIGN_HOME_PATH } from '../paths';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

const NAME_MAX = 120;

const iconButton =
  'flex size-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary';

function ProjectName({
  project,
  editing,
  setEditing,
}: {
  project: DesignProjectDetail;
  editing: boolean;
  setEditing: (editing: boolean) => void;
}) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  const update = useUpdateDesignProjectMutation(project.projectId);
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      return;
    }
    const input = inputRef.current;
    input?.focus();
    input?.select();
    const frame = requestAnimationFrame(() => {
      if (input && document.activeElement !== input) {
        input.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

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
          className={cn(iconButton, 'max-md:hidden')}
          aria-label={localize('workspace.header.rename')}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default function WorkspaceHeader({
  project,
  activePath,
  device,
  compact,
}: {
  project: DesignProjectDetail;
  activePath: string;
  device: DeviceId;
  compact: boolean;
}) {
  const localize = useDesignLocalize();
  const [editing, setEditing] = useState(false);
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-light bg-presentation px-2 md:px-3">
      {compact ? (
        <OpenSidebar className="size-9 shrink-0" />
      ) : (
        <ChatSidebarToggle className={iconButton} />
      )}
      <Link to={DESIGN_HOME_PATH} aria-label={localize('project_back')} className={iconButton}>
        <ArrowLeft className="size-5" aria-hidden="true" />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ProjectName
          key={editing ? 'editing' : 'reading'}
          project={project}
          editing={editing}
          setEditing={setEditing}
        />
        <DesignSystemControl project={project} />
      </div>
      <div className="flex shrink-0 items-center gap-1" data-testid="design-workspace-actions">
        <WorkspaceHeaderActions
          project={project}
          activePath={activePath}
          device={device}
          compact={compact}
          onRename={() => setEditing(true)}
        />
      </div>
    </header>
  );
}
