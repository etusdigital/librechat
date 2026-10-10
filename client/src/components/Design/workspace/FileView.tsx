import { useState } from 'react';
import { FileX2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DesignMe, DesignProjectDetail, FileEntry } from '../api/types';
import type { DesignTranslationKey } from '../i18n';
import { DesignEmptyState } from '../common/DesignStates';
import { useDesignLocalize } from '../i18n';
import MarkdownView from './MarkdownView';
import { fileKindOf } from './file-kind';
import PreviewPane from './PreviewPane';
import MediaView from './MediaView';
import CodeView from './CodeView';
import { cn } from '~/utils';

type ViewChoice = 'primary' | 'code';

function ViewSwitch({
  value,
  primaryKey,
  onChange,
}: {
  value: ViewChoice;
  primaryKey: DesignTranslationKey;
  onChange: (value: ViewChoice) => void;
}) {
  const localize = useDesignLocalize();
  const options: { id: ViewChoice; key: DesignTranslationKey }[] = [
    { id: 'primary', key: primaryKey },
    { id: 'code', key: 'workspace.file.view_code' },
  ];
  return (
    <div
      role="group"
      aria-label={localize('workspace.file.view')}
      className="flex shrink-0 rounded-md border border-border-light p-0.5"
    >
      {options.map(({ id, key }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
            value === id && 'bg-surface-active text-text-primary',
          )}
        >
          {localize(key)}
        </button>
      ))}
    </div>
  );
}

function SwitchBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-light bg-presentation px-2 py-1.5">
      {children}
    </div>
  );
}

export default function FileView({
  project,
  me,
  file,
  path,
  revision,
}: {
  project: DesignProjectDetail;
  me: DesignMe;
  file: FileEntry | undefined;
  path: string;
  revision: number;
}) {
  const localize = useDesignLocalize();
  const [choice, setChoice] = useState<ViewChoice>('primary');
  const projectId = project.projectId;

  if (!file) {
    return (
      <div className="flex flex-1 p-4">
        <DesignEmptyState icon={FileX2} message={localize('workspace.file.missing')} />
      </div>
    );
  }

  const kind = fileKindOf(file.path, file.mime);

  if (kind === 'html') {
    const toggle = (
      <ViewSwitch value={choice} primaryKey="workspace.file.view_preview" onChange={setChoice} />
    );
    if (choice === 'primary') {
      return (
        <PreviewPane project={project} me={me} path={path} revision={revision} leading={toggle} />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SwitchBar>{toggle}</SwitchBar>
        <CodeView projectId={projectId} path={path} />
      </div>
    );
  }

  if (kind === 'markdown') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SwitchBar>
          <ViewSwitch
            value={choice}
            primaryKey="workspace.file.view_reading"
            onChange={setChoice}
          />
        </SwitchBar>
        {choice === 'primary' ? (
          <MarkdownView projectId={projectId} path={path} />
        ) : (
          <CodeView projectId={projectId} path={path} />
        )}
      </div>
    );
  }

  if (kind === 'code') {
    return <CodeView projectId={projectId} path={path} />;
  }

  return <MediaView projectId={projectId} path={path} kind={kind} />;
}
