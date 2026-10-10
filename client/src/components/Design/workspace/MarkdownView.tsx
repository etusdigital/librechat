import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { FileError, FileLoading } from './FileStates';
import { useFileText } from './use-file-content';
import { useDesignLocalize } from '../i18n';

const SAFE_LINK = /^(https?:|mailto:)/i;

const components: Components = {
  a: ({ href, children }) =>
    href && SAFE_LINK.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (alt ? <span className="italic text-text-secondary">{alt}</span> : null),
};

export default function MarkdownView({ projectId, path }: { projectId: string; path: string }) {
  const localize = useDesignLocalize();
  const { text, isLoading, error, refetch } = useFileText(projectId, path);

  if (isLoading || (text === null && !error)) {
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
  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={localize('workspace.file.reading_label', { path })}
      className="min-h-0 flex-1 overflow-auto bg-presentation"
    >
      <article className="markdown prose dark:prose-invert mx-auto w-full max-w-3xl break-words p-4 md:p-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text ?? ''}
        </ReactMarkdown>
      </article>
    </div>
  );
}
