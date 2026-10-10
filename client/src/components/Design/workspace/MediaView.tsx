import { EmptyState } from '@librechat/client';
import { Download, FileQuestion } from 'lucide-react';
import type { FileKind } from './file-kind';
import { FileError, FileLoading } from './FileStates';
import { useFileObjectUrl } from './use-file-content';
import { useDesignLocalize } from '../i18n';
import { fileNameOf } from './file-kind';

export default function MediaView({
  projectId,
  path,
  kind,
}: {
  projectId: string;
  path: string;
  kind: Extract<FileKind, 'image' | 'video' | 'audio' | 'binary'>;
}) {
  const localize = useDesignLocalize();
  const { url, isLoading, error, refetch } = useFileObjectUrl(projectId, path);
  const name = fileNameOf(path);

  if (isLoading) {
    return <FileLoading />;
  }
  if (error) {
    return (
      <FileError
        error={error}
        onRetry={() => {
          refetch();
        }}
      />
    );
  }
  if (!url) {
    return <FileLoading />;
  }

  return (
    <div
      data-testid="design-media-view"
      className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-secondary p-4"
    >
      {kind === 'image' ? (
        <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
      ) : null}
      {kind === 'video' ? (
        <video src={url} controls className="max-h-full max-w-full" aria-label={name}>
          <track kind="captions" />
        </video>
      ) : null}
      {kind === 'audio' ? (
        <audio src={url} controls className="w-full max-w-md" aria-label={name}>
          <track kind="captions" />
        </audio>
      ) : null}
      {kind === 'binary' ? (
        <EmptyState
          icon={FileQuestion}
          description={localize('workspace.file.unsupported')}
          className="rounded-2xl bg-surface-primary px-6 py-12"
          action={
            <a
              href={url}
              download={name}
              className="inline-flex items-center gap-2 rounded-lg border border-border-medium px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              <Download className="size-4" aria-hidden="true" />
              {localize('workspace.file.download')}
            </a>
          }
        />
      ) : null}
    </div>
  );
}
