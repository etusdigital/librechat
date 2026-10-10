import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { SearchX } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import type { ReactNode } from 'react';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import type { MobileTab } from './MobileTabBar';
import {
  closeTab,
  deviceAtom,
  keepExistingTabs,
  openTab,
  workspaceTabsAtomFamily,
} from '../state/atoms';
import { designErrorCode, designErrorMessageKey, isDesignApiError } from '../api/errors';
import DesignChatSlot, { useDesignChatResponding } from '../chat/DesignChatSlot';
import { DesignCardsSkeleton, DesignErrorState } from '../common/DesignStates';
import { clampChatWidth, readChatWidth, storeChatWidth } from './chat-width';
import { useDesignFilesQuery, useDesignProjectQuery } from '../api/queries';
import MobileTabBar, { MOBILE_TAB_PANEL_IDS } from './MobileTabBar';
import DesignAccessGate from '../common/DesignAccessGate';
import { useProjectChanges } from './use-project-changes';
import ChatResizeHandle from './ChatResizeHandle';
import WorkspaceHeader from './WorkspaceHeader';
import DesignPage from '../common/DesignPage';
import { useDesignAccess } from '../access';
import { useDesignLocalize } from '../i18n';
import { DESIGN_HOME_PATH } from '../paths';
import FileDrawer from './FileDrawer';
import FileTabs from './FileTabs';
import FileView from './FileView';
import { cn } from '~/utils';

export const COMPACT_LAYOUT_QUERY = '(max-width: 767px)';

function renameInTabs(tabs: string[], from: string, to: string) {
  return tabs.map((path) => (path === from ? to : path));
}

export function DesignWorkspace({ project, me }: { project: DesignProjectDetail; me: DesignMe }) {
  const localize = useDesignLocalize();
  const projectId = project.projectId;
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const responding = useDesignChatResponding();
  const [tabs, setTabs] = useAtom(workspaceTabsAtomFamily(projectId));
  const [device, setDevice] = useAtom(deviceAtom);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatWidth, setChatWidth] = useState(readChatWidth);
  const [previewUpdated, setPreviewUpdated] = useState(false);
  const filesQuery = useDesignFilesQuery(projectId);
  const files = useMemo(
    () => filesQuery.data ?? project.files ?? [],
    [filesQuery.data, project.files],
  );
  const entry = project.entryFile;

  const { revision } = useProjectChanges({
    projectId,
    responding,
    onChange: () => setPreviewUpdated(true),
  });

  useEffect(() => {
    if (compact) {
      setDevice('mobile');
    }
  }, [compact, setDevice]);

  useEffect(() => {
    if (filesQuery.data) {
      const paths = filesQuery.data.map((file) => file.path);
      setTabs((current) => keepExistingTabs(current, paths));
    }
  }, [filesQuery.data, setTabs]);

  useEffect(() => {
    if (!compact || mobileTab === 'preview') {
      setPreviewUpdated(false);
    }
  }, [compact, mobileTab, revision]);

  const openTabs = useMemo(
    () => [entry, ...tabs.open.filter((path) => path !== entry)],
    [entry, tabs.open],
  );
  const activePath = tabs.active && openTabs.includes(tabs.active) ? tabs.active : entry;
  const activeFile = files.find((file) => file.path === activePath);

  const openFile = useCallback(
    (path: string) => {
      setTabs((current) => openTab(current, path));
      if (compact) {
        setMobileTab('preview');
      }
    },
    [compact, setTabs],
  );

  const onRenamed = useCallback(
    (from: string, to: string) => {
      setTabs((current) => ({
        open: renameInTabs(current.open, from, to),
        active: current.active === from ? to : current.active,
      }));
    },
    [setTabs],
  );

  const drawer = (className?: string) => (
    <FileDrawer
      projectId={projectId}
      files={files}
      entry={entry}
      active={activePath}
      canWrite={project.canWrite}
      loading={filesQuery.isLoading}
      className={className}
      onOpen={openFile}
      onRenamed={onRenamed}
    />
  );

  const showChat = !compact || mobileTab === 'chat';
  const showWorkspace = !compact || mobileTab === 'preview';

  return (
    <main
      data-testid="design-workspace"
      data-layout={compact ? 'compact' : 'split'}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-presentation text-text-primary"
    >
      <WorkspaceHeader
        project={project}
        activePath={activePath}
        device={device}
        compact={compact}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section
          id={MOBILE_TAB_PANEL_IDS.chat}
          role={compact ? 'tabpanel' : 'region'}
          aria-labelledby={compact ? 'design-tab-chat' : undefined}
          aria-label={compact ? undefined : localize('workspace.layout.chat')}
          hidden={!showChat}
          style={compact ? undefined : { width: chatWidth }}
          className={cn(
            'min-h-0 min-w-0 flex-col',
            showChat && 'flex',
            compact ? 'flex-1' : 'shrink-0',
          )}
        >
          <DesignChatSlot key={projectId} project={project} me={me} />
        </section>
        {compact ? null : (
          <ChatResizeHandle
            width={chatWidth}
            onResize={setChatWidth}
            onCommit={(width) => storeChatWidth(clampChatWidth(width))}
          />
        )}
        <section
          id={MOBILE_TAB_PANEL_IDS.preview}
          role={compact ? 'tabpanel' : 'region'}
          aria-labelledby={compact ? 'design-tab-preview' : undefined}
          aria-label={compact ? undefined : localize('workspace.layout.workspace')}
          hidden={!showWorkspace}
          className={cn('min-h-0 min-w-0 flex-1 flex-col', showWorkspace && 'flex')}
        >
          <FileTabs
            tabs={openTabs}
            active={activePath}
            entry={entry}
            files={files}
            drawerOpen={drawerOpen}
            onSelect={(path) => setTabs((current) => openTab(current, path))}
            onClose={(path) => setTabs((current) => closeTab(current, path))}
            onToggleDrawer={compact ? undefined : () => setDrawerOpen((open) => !open)}
          />
          <div className="flex min-h-0 flex-1">
            {!compact && drawerOpen ? drawer('w-60 shrink-0 border-r border-border-light') : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <FileView
                key={activePath}
                project={project}
                me={me}
                file={activeFile}
                path={activePath}
                revision={revision}
              />
            </div>
          </div>
        </section>
        {compact ? (
          <section
            id={MOBILE_TAB_PANEL_IDS.files}
            role="tabpanel"
            aria-labelledby="design-tab-files"
            hidden={mobileTab !== 'files'}
            className={cn('min-h-0 flex-1 flex-col', mobileTab === 'files' && 'flex')}
          >
            {mobileTab === 'files' ? drawer('flex-1') : null}
          </section>
        ) : null}
      </div>
      {compact ? (
        <MobileTabBar active={mobileTab} previewUpdated={previewUpdated} onChange={setMobileTab} />
      ) : null}
      <div aria-live="polite" className="sr-only">
        {previewUpdated ? localize('workspace.layout.preview_updated') : ''}
      </div>
    </main>
  );
}

function GatedPage({ children }: { children: ReactNode }) {
  const localize = useDesignLocalize();
  return (
    <DesignPage
      title={localize('project_title_fallback')}
      back={{ to: DESIGN_HOME_PATH, label: localize('project_back') }}
    >
      {children}
    </DesignPage>
  );
}

function ProjectWorkspace({ projectId, me }: { projectId: string; me: DesignMe }) {
  const localize = useDesignLocalize();
  const { data: project, error, isLoading, refetch } = useDesignProjectQuery(projectId);

  if (isLoading) {
    return (
      <GatedPage>
        <DesignCardsSkeleton label={localize('loading')} count={2} />
      </GatedPage>
    );
  }
  if (error || !project) {
    const notFound =
      isDesignApiError(error) &&
      error.status === 404 &&
      designErrorCode(error) !== 'design_disabled';
    const key = designErrorMessageKey(error);
    return (
      <GatedPage>
        {notFound ? (
          <DesignErrorState icon={SearchX} message={localize('project_not_found')} />
        ) : (
          <DesignErrorState
            message={localize(key === 'error_generic' ? 'project_error' : key)}
            onRetry={() => {
              refetch();
            }}
          />
        )}
      </GatedPage>
    );
  }
  return <DesignWorkspace project={project} me={me} />;
}

export default function DesignWorkspacePage() {
  const { projectId = '' } = useParams();
  const { access } = useDesignAccess();
  if (access.status === 'granted') {
    return <ProjectWorkspace key={projectId} projectId={projectId} me={access.me} />;
  }
  return (
    <GatedPage>
      <DesignAccessGate>{() => null}</DesignAccessGate>
    </GatedPage>
  );
}
