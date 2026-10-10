import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Spinner,
} from '@librechat/client';
import type { DesignJob, DesignProject } from '../../api/types';
import type { DeviceId } from '../../state/atoms';
import {
  exportOptionsFor,
  safeDownloadUrl,
  type ExportOption,
  type ExportOptionId,
} from './options';
import { useDesignJobQuery, useDesignMeQuery, isJobFinished } from '../../api/queries';
import { actionErrorMessageKey, jobErrorMessageKey } from '../actions/errors';
import { useExportProjectMutation } from '../../api/action-queries';
import { useDesignLocalize } from '../../i18n';
import { startDownload } from './download';

function downloadOf(job: DesignJob | undefined) {
  const first = job?.downloads?.[0];
  const url = safeDownloadUrl(first?.url ?? job?.downloadUrl, window.location.origin);
  if (!url) {
    return null;
  }
  return { url, fileName: typeof first?.fileName === 'string' ? first.fileName : undefined };
}

function ExportOptionButton({
  option,
  busy,
  onChoose,
}: {
  option: ExportOption;
  busy: boolean;
  onChoose: (option: ExportOption) => void;
}) {
  const localize = useDesignLocalize();
  const reasonId = `design-export-${option.id}-reason`;
  const disabled = option.disabledReasonKey !== null || busy;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={reasonId}
        onClick={() => onChoose(option)}
        className="flex w-full flex-col items-start gap-0.5 rounded-lg border border-border-light px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <span
          className={`flex items-center gap-2 text-sm font-medium ${
            option.disabledReasonKey ? 'text-text-secondary' : 'text-text-primary'
          }`}
        >
          {localize(option.labelKey)}
          {option.beta ? (
            <span className="rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-normal text-text-primary">
              {localize('actions.export_beta')}
            </span>
          ) : null}
        </span>
        <span id={reasonId} className="text-xs text-text-secondary">
          {localize(option.disabledReasonKey ?? option.descriptionKey)}
        </span>
      </button>
    </li>
  );
}

function ExportProgress({
  option,
  job,
  requestError,
}: {
  option: ExportOption;
  job: DesignJob | undefined;
  requestError: unknown;
}) {
  const localize = useDesignLocalize();
  const label = localize(option.labelKey);
  const download = downloadOf(job);

  let content;
  if (requestError) {
    content = (
      <span className="flex items-start gap-2">
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {localize(actionErrorMessageKey(requestError, 'actions.error_export_failed'))}
      </span>
    );
  } else if (job?.status === 'failed') {
    content = (
      <span className="flex items-start gap-2">
        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {localize(jobErrorMessageKey(job.error))}
      </span>
    );
  } else if (job?.status === 'succeeded') {
    content = (
      <span className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        {download
          ? localize('actions.export_ready', { format: label })
          : localize('actions.export_ready_no_file')}
        {download ? (
          <a
            href={download.url}
            download={download.fileName}
            rel="noopener"
            className="inline-flex items-center gap-1 font-medium text-text-primary underline underline-offset-4"
          >
            <Download className="size-4" aria-hidden="true" />
            {localize('actions.export_download_again')}
          </a>
        ) : null}
      </span>
    );
  } else {
    content = (
      <span className="flex items-center gap-2">
        <Spinner className="size-4" />
        {localize(job?.status === 'running' ? 'actions.export_running' : 'actions.export_queued', {
          format: label,
        })}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl bg-surface-secondary p-3 text-sm text-text-primary"
    >
      {content}
    </div>
  );
}

export default function ExportMenu({
  project,
  path,
  device,
  open,
  onOpenChange,
}: {
  project: DesignProject;
  path: string | null;
  device: DeviceId | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useDesignLocalize();
  const { data: me } = useDesignMeQuery();
  const exportProject = useExportProjectMutation(project.projectId);
  const [chosen, setChosen] = useState<ExportOptionId | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { data: job } = useDesignJobQuery(jobId);
  const downloaded = useRef(new Set<string>());

  const options = useMemo(
    () => exportOptionsFor({ permissions: me?.permissions ?? [], path, device }),
    [me?.permissions, path, device],
  );
  const chosenOption = options.find((option) => option.id === chosen) ?? null;
  const busy = exportProject.isLoading || Boolean(jobId && !isJobFinished(job));

  useEffect(() => {
    if (!job || job.status !== 'succeeded' || downloaded.current.has(job.jobId)) {
      return;
    }
    downloaded.current.add(job.jobId);
    const download = downloadOf(job);
    if (download) {
      startDownload(download.url, download.fileName);
    }
  }, [job]);

  const choose = (option: ExportOption) => {
    setChosen(option.id);
    setJobId(null);
    exportProject.mutate(option.request, {
      onSuccess: (created) => setJobId(created.jobId),
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-lg flex-col overflow-hidden">
        <OGDialogHeader>
          <OGDialogTitle>{localize('actions.export_title')}</OGDialogTitle>
          <OGDialogDescription className="truncate">
            {path ? localize('actions.export_file', { path }) : localize('actions.export_no_file')}
          </OGDialogDescription>
        </OGDialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {chosenOption ? (
            <ExportProgress option={chosenOption} job={job} requestError={exportProject.error} />
          ) : null}
          <ul aria-label={localize('actions.export_formats_label')} className="flex flex-col gap-2">
            {options.map((option) => (
              <ExportOptionButton key={option.id} option={option} busy={busy} onChoose={choose} />
            ))}
          </ul>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
