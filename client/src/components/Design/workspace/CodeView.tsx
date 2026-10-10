import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { FileError, FileLoading } from './FileStates';
import { useFileText } from './use-file-content';
import { codeLanguageOf } from './file-kind';
import { useDesignLocalize } from '../i18n';

export const HIGHLIGHT_MAX_CHARS = 200_000;

const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];

export function fencedCode(code: string, language: string) {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

const HighlightedCode = memo(function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  if (code.length > HIGHLIGHT_MAX_CHARS) {
    return <code className="hljs !whitespace-pre">{code}</code>;
  }
  return (
    <ReactMarkdown
      /* @ts-expect-error rehypePlugins type mismatch between react-markdown and unified */
      rehypePlugins={rehypePlugins}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => (
          <code className={`hljs ${className ?? ''} !whitespace-pre`}>{children}</code>
        ),
      }}
    >
      {fencedCode(code, language)}
    </ReactMarkdown>
  );
});

export default function CodeView({ projectId, path }: { projectId: string; path: string }) {
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
      data-testid="design-code-view"
      className="min-h-0 flex-1 overflow-auto bg-surface-primary"
      role="region"
      tabIndex={0}
      aria-label={localize('workspace.file.code_label', { path })}
    >
      <pre className="min-w-fit p-4 font-mono text-xs leading-relaxed text-text-primary md:text-sm">
        <HighlightedCode code={text ?? ''} language={codeLanguageOf(path)} />
      </pre>
    </div>
  );
}
