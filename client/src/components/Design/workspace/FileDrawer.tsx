import { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, Pencil, Trash2, Upload } from 'lucide-react';
import {
  Button,
  Input,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { ChangeEvent, FormEvent } from 'react';
import type { DesignTranslationKey } from '../i18n';
import type { FileEntry } from '../api/types';
import {
  useDeleteFileMutation,
  useRenameFileMutation,
  useUploadFilesMutation,
} from '../api/workspace-queries';
import { designErrorCode, designErrorMessageKey } from '../api/errors';
import { directoryOf, fileKindOf, fileNameOf } from './file-kind';
import { DesignEmptyState } from '../common/DesignStates';
import { toolbarButton } from './PreviewToolbar';
import { NotificationSeverity } from '~/common';
import { FILE_KIND_ICONS } from './file-icons';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

const FILE_ERROR_KEYS: Record<string, DesignTranslationKey> = {
  file_exists: 'workspace.drawer.error_exists',
  path_in_use: 'workspace.drawer.error_exists',
  payload_too_large: 'workspace.drawer.error_too_large',
  file_too_large: 'workspace.drawer.error_too_large',
};

export function groupByDirectory(files: FileEntry[]) {
  const groups = new Map<string, FileEntry[]>();
  [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      const directory = directoryOf(file.path);
      groups.set(directory, [...(groups.get(directory) ?? []), file]);
    });
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === '' || b === '') {
      return a === '' ? -1 : 1;
    }
    return a.localeCompare(b);
  });
}

function useFileErrorToast(fallback: DesignTranslationKey) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  return (error: unknown) => {
    const code = designErrorCode(error) ?? '';
    const generic = designErrorMessageKey(error);
    showToast({
      message: localize(
        FILE_ERROR_KEYS[code] ?? (generic === 'error_generic' ? fallback : generic),
      ),
      severity: NotificationSeverity.ERROR,
      showIcon: true,
    });
  };
}

function RenameDialog({
  projectId,
  path,
  onClose,
  onRenamed,
}: {
  projectId: string;
  path: string;
  onClose: () => void;
  onRenamed: (from: string, to: string) => void;
}) {
  const localize = useDesignLocalize();
  const rename = useRenameFileMutation(projectId);
  const toast = useFileErrorToast('workspace.drawer.error_rename');
  const [draft, setDraft] = useState(path);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const name = fileNameOf(path);
    const dot = name.lastIndexOf('.');
    const start = path.length - name.length;
    input.setSelectionRange(start, dot > 0 ? start + dot : path.length);
  }, [path]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const to = draft.trim().replace(/^\/+/, '');
    if (!to || to === path) {
      onClose();
      return;
    }
    rename.mutate(
      { from: path, to },
      {
        onSuccess: (entry) => {
          onRenamed(path, entry?.path ?? to);
          onClose();
        },
        onError: toast,
      },
    );
  };

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{localize('workspace.drawer.rename_title')}</OGDialogTitle>
        </OGDialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={localize('workspace.drawer.rename_label')}
            disabled={rename.isLoading}
          />
          <div className="flex justify-end gap-2">
            <OGDialogClose asChild>
              <Button type="button" variant="outline">
                {localize('workspace.cancel')}
              </Button>
            </OGDialogClose>
            <Button type="submit" disabled={rename.isLoading}>
              {rename.isLoading ? <Spinner className="size-4" /> : localize('workspace.save')}
            </Button>
          </div>
        </form>
      </OGDialogContent>
    </OGDialog>
  );
}

function DeleteDialog({
  projectId,
  path,
  onClose,
}: {
  projectId: string;
  path: string;
  onClose: () => void;
}) {
  const localize = useDesignLocalize();
  const remove = useDeleteFileMutation(projectId);
  const toast = useFileErrorToast('workspace.drawer.error_delete');

  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="w-11/12 max-w-md" showCloseButton={false}>
        <OGDialogHeader>
          <OGDialogTitle>{localize('workspace.drawer.delete_title')}</OGDialogTitle>
        </OGDialogHeader>
        <p className="text-sm text-text-secondary">
          {localize('workspace.drawer.delete_confirm', { path })}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <OGDialogClose asChild>
            <Button type="button" variant="outline">
              {localize('workspace.cancel')}
            </Button>
          </OGDialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isLoading}
            onClick={() => remove.mutate(path, { onSuccess: onClose, onError: toast })}
          >
            {remove.isLoading ? <Spinner className="size-4" /> : localize('workspace.delete')}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}

export default function FileDrawer({
  projectId,
  files,
  entry,
  active,
  canWrite,
  loading,
  className,
  onOpen,
  onRenamed,
}: {
  projectId: string;
  files: FileEntry[];
  entry: string;
  active: string;
  canWrite: boolean;
  loading?: boolean;
  className?: string;
  onOpen: (path: string) => void;
  onRenamed: (from: string, to: string) => void;
}) {
  const localize = useDesignLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadFilesMutation(projectId);
  const uploadError = useFileErrorToast('workspace.drawer.error_upload');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const groups = useMemo(() => groupByDirectory(files), [files]);

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (picked.length > 0) {
      upload.mutate(picked, { onError: uploadError });
    }
  };

  return (
    <nav
      aria-label={localize('workspace.drawer.label')}
      className={cn('flex min-h-0 flex-col bg-presentation', className)}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border-light px-3">
        <h2 className="text-sm font-semibold text-text-primary">
          {localize('workspace.drawer.title')}
        </h2>
        {canWrite ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onFiles}
              data-testid="design-file-upload-input"
            />
            <button
              type="button"
              className={toolbarButton}
              aria-label={localize('workspace.drawer.upload')}
              title={localize('workspace.drawer.upload')}
              disabled={upload.isLoading}
              onClick={() => inputRef.current?.click()}
            >
              {upload.isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
            </button>
          </>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {loading && files.length === 0 ? (
          <div role="status" className="flex justify-center p-4">
            <Spinner className="size-4" />
            <span className="sr-only">{localize('workspace.file.loading')}</span>
          </div>
        ) : null}
        {!loading && files.length === 0 ? (
          <div className="flex p-3">
            <DesignEmptyState icon={FilePlus2} message={localize('workspace.drawer.empty')} />
          </div>
        ) : null}
        {groups.map(([directory, entries]) => (
          <section
            key={directory || '.'}
            aria-label={directory || localize('workspace.drawer.root')}
          >
            {directory ? (
              <h3 className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-xs font-medium text-text-secondary">
                <FolderOpen className="size-3.5" aria-hidden="true" />
                <span className="truncate">{directory}</span>
              </h3>
            ) : null}
            <ul>
              {entries.map((file) => {
                const Icon = FILE_KIND_ICONS[fileKindOf(file.path, file.mime)];
                const name = fileNameOf(file.path);
                const isActive = file.path === active;
                const rowButton = cn(
                  toolbarButton,
                  'md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100',
                  isActive && 'text-text-primary md:opacity-100',
                );
                return (
                  <li
                    key={file.path}
                    className={cn(
                      'group flex items-center gap-1 pr-1',
                      isActive ? 'bg-surface-active' : 'hover:bg-surface-hover',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(file.path)}
                      aria-current={isActive ? 'true' : undefined}
                      title={file.path}
                      className={cn(
                        'flex min-h-10 min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary',
                        directory ? 'pl-7' : 'pl-3',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-text-primary' : 'text-text-secondary',
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{name}</span>
                      {file.path === entry ? (
                        <span
                          className={cn(
                            'shrink-0 rounded border px-1.5 text-[10px] uppercase tracking-wide',
                            isActive
                              ? 'border-text-primary/40 text-text-primary'
                              : 'border-border-light text-text-secondary',
                          )}
                        >
                          {localize('workspace.drawer.entry')}
                        </span>
                      ) : null}
                    </button>
                    {canWrite ? (
                      <>
                        <button
                          type="button"
                          className={rowButton}
                          aria-label={localize('workspace.drawer.rename', { name })}
                          onClick={() => setRenaming(file.path)}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </button>
                        {file.path === entry ? null : (
                          <button
                            type="button"
                            className={rowButton}
                            aria-label={localize('workspace.drawer.delete', { name })}
                            onClick={() => setDeleting(file.path)}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {renaming ? (
        <RenameDialog
          projectId={projectId}
          path={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={onRenamed}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog projectId={projectId} path={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </nav>
  );
}
