import { useCallback, useEffect, useMemo, useState } from 'react';
import { SearchX } from 'lucide-react';
import { useAtom, useSetAtom } from 'jotai';
import { useParams } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import type { ReactNode } from 'react';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import type { WorkspaceTab } from './workspace-tabs';
import type { MobileTab } from './MobileTabBar';
import {
  closeTab,
  deviceAtom,
  keepExistingTabs,
  openTab,
  previewHighlightAtom,
  workspacePanelAtom,
  workspaceTabsAtomFamily,
} from '../state/atoms';
import { SIDE_PANEL_IDS, useExclusiveWorkspacePanels } from './side-panel/use-workspace-panel';
import { designErrorCode, designErrorMessageKey, isDesignApiError } from '../api/errors';
import { DesignCardsSkeleton, DesignErrorState } from '../common/DesignStates';
import { clampChatWidth, readChatWidth, storeChatWidth } from './chat-width';
import { useDesignFilesQuery, useDesignProjectQuery } from '../api/queries';
import { useApplyDesignSystemRequest } from './use-apply-design-system';
import MobileTabBar, { MOBILE_TAB_PANEL_IDS } from './MobileTabBar';
import WorkspaceSidePanel from './side-panel/WorkspaceSidePanel';
import { COMPACT_LAYOUT_QUERY, modePanelLayout } from './layout';
import { hasDesignPermission, useDesignAccess } from '../access';
import { useIsResponding } from '../chat/DesignChatAdapter';
import { usePlanActivity } from './plan/use-plan-activity';
import DesignAccessGate from '../common/DesignAccessGate';
import { useProjectChanges } from './use-project-changes';
import { WorkspaceTabsProvider } from './workspace-tabs';
import { usePendingBrief } from '../state/pending-brief';
import DesignChatSlot from '../chat/DesignChatSlot';
import { useElementSize } from './use-element-size';
import ChatResizeHandle from './ChatResizeHandle';
import { reviewPathOf } from './jury/jury-state';
import WorkspaceHeader from './WorkspaceHeader';
import { JuryProvider } from './jury/use-jury';
import DesignPage from '../common/DesignPage';
import { useDesignLocalize } from '../i18n';
import { DESIGN_HOME_PATH } from '../paths';
import JuryPanel from './jury/JuryPanel';
import PlanPanel from './plan/PlanPanel';
import FileDrawer from './FileDrawer';
import FileTabs from './FileTabs';
import FileView from './FileView';
import { cn } from '~/utils';

export { COMPACT_LAYOUT_QUERY } from './layout';

function renameInTabs(tabs: string[], from: string, to: string) {
  return tabs.map((path) => (path === from ? to : path));
}

export function DesignWorkspace({ project, me }: { project: DesignProjectDetail; me: DesignMe }) {
  const localize = useDesignLocalize();
  const projectId = project.projectId;
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const responding = useIsResponding();
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
  const { composerText, clearComposerText } = useApplyDesignSystemRequest();
  const pendingBrief = usePendingBrief(projectId);

  const [panel, setPanel] = useAtom(workspacePanelAtom);
  const setHighlight = useSetAtom(previewHighlightAtom);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const juryEnabled = hasDesignPermission(me, 'review.jury');
  useExclusiveWorkspacePanels();
  const planAnnouncement = usePlanActivity({ projectId, compact, responding });

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
  const reviewPath = reviewPathOf(files, activePath, entry);

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

  const focusTab = useCallback(
    (tab: WorkspaceTab) => {
      if (compact) {
        setMobileTab(tab);
      }
    },
    [compact],
  );

  const closePanel = useCallback(() => {
    setPanel(null);
    setHighlight(null);
  }, [setHighlight, setPanel]);

  const sideLayout = modePanelLayout(compact, area.width);
  let sidePanel: ReactNode = null;
  if (panel === 'plan') {
    sidePanel = (
      <WorkspaceSidePanel
        id={SIDE_PANEL_IDS.plan}
        title={localize('plan.title')}
        layout={sideLayout}
        onClose={closePanel}
      >
        <PlanPanel projectId={projectId} />
      </WorkspaceSidePanel>
    );
  } else if (panel === 'jury' && juryEnabled) {
    sidePanel = (
      <WorkspaceSidePanel
        id={SIDE_PANEL_IDS.jury}
        title={localize('jury.title')}
        layout={sideLayout}
        onClose={closePanel}
      >
        <JuryPanel projectId={projectId} canWrite={project.canWrite} />
      </WorkspaceSidePanel>
    );
  }

  const showChat = !compact || mobileTab === 'chat';
  const showWorkspace = !compact || mobileTab === 'preview';

  const workspace = (
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
          <DesignChatSlot
            key={projectId}
            project={project}
            me={me}
            pendingBrief={pendingBrief}
            composerText={composerText}
            onComposerTextUsed={clearComposerText}
          />
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
          className={cn(
            'relative isolate min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            showWorkspace && 'flex',
          )}
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
            <div
              ref={areaRef}
              data-testid="design-workspace-area"
              className="relative flex min-h-0 min-w-0 flex-1 flex-col md:flex-row"
            >
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
              {sidePanel}
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
      <div aria-live="polite" data-testid="design-plan-announcement" className="sr-only">
        {planAnnouncement}
      </div>
    </main>
  );

  return (
    <JuryProvider projectId={projectId} enabled={juryEnabled} reviewPath={reviewPath}>
      <WorkspaceTabsProvider onFocus={focusTab}>{workspace}</WorkspaceTabsProvider>
    </JuryProvider>
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
