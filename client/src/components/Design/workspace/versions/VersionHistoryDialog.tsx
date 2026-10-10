import { useEffect, useMemo, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Skeleton,
  useToastContext,
} from '@librechat/client';
import type { DesignMe, DesignProject, FileVersion } from '../../api/types';
import {
  VERSION_SOURCE_KEYS,
  compareLines,
  formatBytes,
  isComparableText,
  isPreviewable,
  versionAuthor,
} from './compare';
import {
  useRestoreVersionMutation,
  useVersionPreviewQuery,
  useVersionTextQuery,
} from '../../api/action-queries';
import { PREVIEW_REFERRER_POLICY, PREVIEW_SANDBOX } from '../../preview/host-protocol';
import { DesignEmptyState, DesignErrorState } from '../../common/DesignStates';
import { useDesignMeQuery, useDesignVersionsQuery } from '../../api/queries';
import { useDesignLocalize, type DesignLocalize } from '../../i18n';
import ConfirmActionDialog from '../actions/ConfirmActionDialog';
import { actionErrorMessageKey } from '../actions/errors';

function formatDateTime(value: string | null) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function authorLabel(
  localize: DesignLocalize,
  version: FileVersion,
  me: DesignMe | undefined,
  project: DesignProject,
) {
  const author = versionAuthor(version, me, project);
  return 'name' in author ? author.name : localize(author.key);
}

function VersionComparison({
  projectId,
  selected,
  current,
}: {
  projectId: string;
  selected: FileVersion;
  current: FileVersion;
}) {
  const localize = useDesignLocalize();
  const sameContent = selected.sha256 === current.sha256;
  const comparable = !sameContent && isComparableText(selected) && isComparableText(current);
  const selectedText = useVersionTextQuery(
    { projectId, path: selected.path, version: selected.version },
    { enabled: comparable },
  );
  const currentText = useVersionTextQuery(
    { projectId, path: current.path, version: current.version },
    { enabled: comparable },
  );
  const lines = useMemo(
    () =>
      selectedText.data !== undefined && currentText.data !== undefined
        ? compareLines(currentText.data, selectedText.data)
        : null,
    [selectedText.data, currentText.data],
  );

  const sizeDelta = selected.size - current.size;
  return (
    <ul
      aria-label={localize('actions.versions_compare_label', { version: current.version })}
      className="flex flex-col gap-1 rounded-xl bg-surface-secondary p-3 text-sm text-text-secondary"
    >
      {sameContent ? (
        <li>{localize('actions.versions_compare_same')}</li>
      ) : (
        <>
          <li>
            {localize('actions.versions_compare_size', {
              size: formatBytes(selected.size),
              delta: `${sizeDelta >= 0 ? '+' : '-'}${formatBytes(Math.abs(sizeDelta))}`,
            })}
          </li>
          {lines ? (
            <li>
              {localize('actions.versions_compare_lines', {
                added: lines.added,
                removed: lines.removed,
              })}
            </li>
          ) : null}
          {comparable && !lines && !selectedText.error && !currentText.error ? (
            <li>
              <Skeleton className="h-4 w-40" />
            </li>
          ) : null}
        </>
      )}
    </ul>
  );
}

function VersionPreview({ projectId, version }: { projectId: string; version: FileVersion }) {
  const localize = useDesignLocalize();
  const previewable = isPreviewable(version);
  const { data, error, isLoading } = useVersionPreviewQuery(
    { projectId, path: version.path, version: version.version },
    { enabled: previewable },
  );
  if (!previewable) {
    return (
      <p className="rounded-xl bg-surface-secondary p-3 text-sm text-text-secondary">
        {localize('actions.versions_preview_unavailable')}
      </p>
    );
  }
  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl md:h-full" />;
  }
  if (error || !data) {
    return (
      <p role="alert" className="rounded-xl bg-surface-secondary p-3 text-sm text-text-secondary">
        {localize('actions.versions_preview_error')}
      </p>
    );
  }
  return (
    <iframe
      title={localize('actions.versions_preview_title', { version: version.version })}
      src={data.url}
      sandbox={PREVIEW_SANDBOX}
      referrerPolicy={PREVIEW_REFERRER_POLICY}
      loading="lazy"
      className="h-64 w-full rounded-xl border border-border-light bg-white md:h-full md:min-h-[18rem]"
    />
  );
}

function VersionAction({
  isCurrent,
  canWrite,
  onRestore,
}: {
  isCurrent: boolean;
  canWrite: boolean;
  onRestore: () => void;
}) {
  const localize = useDesignLocalize();
  if (isCurrent) {
    return (
      <span className="rounded-full bg-surface-tertiary px-2.5 py-1 text-xs font-medium text-text-primary">
        {localize('actions.versions_current')}
      </span>
    );
  }
  if (!canWrite) {
    return <p className="text-xs text-text-secondary">{localize('actions.versions_read_only')}</p>;
  }
  return (
    <Button type="button" size="sm" onClick={onRestore}>
      <RotateCcw className="size-4" aria-hidden="true" />
      {localize('actions.versions_restore')}
    </Button>
  );
}

function VersionDetail({
  project,
  version,
  current,
  me,
  onRestore,
}: {
  project: DesignProject;
  version: FileVersion;
  current: FileVersion;
  me: DesignMe | undefined;
  onRestore: () => void;
}) {
  const localize = useDesignLocalize();
  const isCurrent = version.version === current.version;
  return (
    <section
      aria-labelledby="design-version-detail"
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="design-version-detail" className="text-base font-semibold text-text-primary">
            {localize('actions.versions_number', { version: version.version })}
          </h3>
          <p className="text-sm text-text-secondary">
            {[
              formatDateTime(version.createdAt),
              authorLabel(localize, version, me, project),
              localize(VERSION_SOURCE_KEYS[version.source]),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {version.note ? <p className="text-sm text-text-primary">{version.note}</p> : null}
        </div>
        <VersionAction isCurrent={isCurrent} canWrite={project.canWrite} onRestore={onRestore} />
      </div>
      {isCurrent ? null : (
        <VersionComparison projectId={project.projectId} selected={version} current={current} />
      )}
      <VersionPreview projectId={project.projectId} version={version} />
    </section>
  );
}

function VersionList({
  versions,
  selected,
  onSelect,
  me,
  project,
}: {
  versions: FileVersion[];
  selected: number | null;
  onSelect: (version: number) => void;
  me: DesignMe | undefined;
  project: DesignProject;
}) {
  const localize = useDesignLocalize();
  return (
    <ul
      aria-label={localize('actions.versions_list_label')}
      className="flex max-h-56 shrink-0 flex-col gap-1 overflow-y-auto md:max-h-none md:w-64"
    >
      {versions.map((version) => {
        const active = version.version === selected;
        return (
          <li key={version.versionId}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(version.version)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${
                active ? 'bg-surface-active' : 'hover:bg-surface-hover'
              }`}
            >
              <span className="text-sm font-medium text-text-primary">
                {localize('actions.versions_number', { version: version.version })}
                {' · '}
                {localize(VERSION_SOURCE_KEYS[version.source])}
              </span>
              <span className="text-xs text-text-secondary">
                {formatDateTime(version.createdAt)}
                {' · '}
                {authorLabel(localize, version, me, project)}
              </span>
              {version.note ? (
                <span className="line-clamp-1 text-xs text-text-secondary">{version.note}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function VersionHistoryBody({ project, path }: { project: DesignProject; path: string }) {
  const localize = useDesignLocalize();
  const { showToast } = useToastContext();
  const { data: me } = useDesignMeQuery();
  const {
    data: versions,
    error,
    isLoading,
    refetch,
  } = useDesignVersionsQuery({
    projectId: project.projectId,
    path,
  });
  const restore = useRestoreVersionMutation(project.projectId);
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const current = versions?.[0];
  const selectedVersion =
    versions?.find((version) => version.version === selected) ?? versions?.[0] ?? null;

  useEffect(() => {
    setSelected(null);
  }, [path]);

  if (isLoading) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{localize('loading')}</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <DesignErrorState
        message={localize(actionErrorMessageKey(error, 'actions.versions_error'))}
        onRetry={() => {
          refetch();
        }}
      />
    );
  }
  if (!versions || versions.length === 0 || !current || !selectedVersion) {
    return <DesignEmptyState icon={History} message={localize('actions.versions_empty')} />;
  }

  const confirmRestore = () => {
    const from = selectedVersion.version;
    restore.mutate(
      { path, version: from },
      {
        onSuccess: (result) => {
          setConfirming(false);
          setSelected(result.version);
          showToast({
            status: 'success',
            message: localize('actions.versions_restored', { from, version: result.version }),
          });
        },
        onError: (restoreError) => {
          setConfirming(false);
          showToast({
            status: 'error',
            message: localize(
              actionErrorMessageKey(restoreError, 'actions.versions_restore_error'),
            ),
          });
        },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
      <VersionList
        versions={versions}
        selected={selectedVersion.version}
        onSelect={setSelected}
        me={me}
        project={project}
      />
      <VersionDetail
        project={project}
        version={selectedVersion}
        current={current}
        me={me}
        onRestore={() => setConfirming(true)}
      />
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={localize('actions.versions_restore_title', { version: selectedVersion.version })}
        description={localize('actions.versions_restore_description', {
          version: selectedVersion.version,
          next: current.version + 1,
        })}
        confirmLabel={localize('actions.versions_restore')}
        onConfirm={confirmRestore}
        isLoading={restore.isLoading}
      />
    </div>
  );
}

export default function VersionHistoryDialog({
  project,
  path,
  open,
  onOpenChange,
}: {
  project: DesignProject;
  path: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useDesignLocalize();
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-5xl flex-col overflow-hidden">
        <OGDialogHeader>
          <OGDialogTitle>{localize('actions.versions_title')}</OGDialogTitle>
          <OGDialogDescription className="truncate">
            {path ?? localize('actions.versions_no_file')}
          </OGDialogDescription>
        </OGDialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:min-h-[24rem]">
          {path ? (
            <VersionHistoryBody project={project} path={path} />
          ) : (
            <DesignEmptyState icon={History} message={localize('actions.versions_no_file')} />
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
