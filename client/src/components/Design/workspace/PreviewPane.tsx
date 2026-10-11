import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAtom, useAtomValue } from 'jotai';
import { Spinner, useMediaQuery } from '@librechat/client';
import type { ReactNode } from 'react';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import { deviceAtom, previewHighlightAtom, workspaceModeAtom, zoomAtom } from '../state/atoms';
import { PREVIEW_REFERRER_POLICY, PREVIEW_SANDBOX } from '../preview/host-protocol';
import { usePreviewBridge } from '../preview/use-preview-bridge';
import { COMPACT_LAYOUT_QUERY, modePanelLayout } from './layout';
import PreviewToolbar, { toolbarButton } from './PreviewToolbar';
import { usePreviewUrlQuery } from '../api/workspace-queries';
import { DesignErrorState } from '../common/DesignStates';
import { availableModes, modeExtension } from './modes';
import { designErrorMessageKey } from '../api/errors';
import { isPreviewUrlFresh } from '../api/workspace';
import { previewGeometry } from './preview-geometry';
import { useElementSize } from './use-element-size';
import { useDesignLocalize } from '../i18n';
import DeviceFrame from './DeviceFrame';
import { cn } from '~/utils';

export default function PreviewPane({
  project,
  me,
  path,
  revision,
  leading,
}: {
  project: DesignProjectDetail;
  me: DesignMe;
  path: string;
  revision: number;
  leading?: ReactNode;
}) {
  const localize = useDesignLocalize();
  const [device, setDevice] = useAtom(deviceAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);
  const [mode, setMode] = useAtom(workspaceModeAtom);
  const highlight = useAtomValue(previewHighlightAtom);
  const modes = availableModes();
  const extension = modeExtension(mode);
  const previewUrl = usePreviewUrlQuery({ projectId: project.projectId, path });
  const url = previewUrl.data?.url ?? null;
  const bridge = usePreviewBridge({ previewUrl: url, mode: extension.bridgeMode });
  const [loaded, setLoaded] = useState(false);
  const [stageRef, area] = useElementSize<HTMLDivElement>();
  const [rowRef, row] = useElementSize<HTMLDivElement>();
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const panelId = useId();
  const geometry = previewGeometry(device, zoom, area);
  const { reload, subscribe, ready, send } = bridge;
  const { refetch, data } = previewUrl;
  const { Overlay, Panel, opensPanelOn } = extension;
  const panelLayout = modePanelLayout(compact, row.width);
  const drawer = Panel != null && panelLayout === 'drawer';
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  const refresh = useCallback(() => {
    if (isPreviewUrlFresh(data)) {
      reload();
    } else {
      refetch();
    }
  }, [data, reload, refetch]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (revision > 0) {
      refreshRef.current();
    }
  }, [revision]);

  useEffect(() => {
    setLoaded(false);
  }, [bridge.src]);

  const viewportWidth = geometry.viewport.width;
  useEffect(() => {
    if (!highlight || highlight.path !== path || !ready) {
      return;
    }
    send({ type: 'etus:highlight', selector: highlight.selector });
  }, [highlight, path, ready, send, device, viewportWidth]);

  useEffect(() => {
    if (mode !== extension.mode) {
      setMode(extension.mode);
    }
  }, [extension.mode, mode, setMode]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [extension.mode]);

  useEffect(() => {
    if (!drawer || !opensPanelOn) {
      return;
    }
    return subscribe((message) => {
      if (message.type === 'etus:target' && opensPanelOn(message, geometryRef.current)) {
        setDrawerOpen(true);
      }
    });
  }, [drawer, opensPanelOn, subscribe]);

  const context = { project, me, path, device, geometry, bridge };
  const modeLabel = localize(extension.labelKey);

  let stage: ReactNode;
  if (previewUrl.isLoading) {
    stage = (
      <div role="status" className="m-auto flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="size-4" />
        {localize('workspace.preview.loading')}
      </div>
    );
  } else if (previewUrl.error || !bridge.src) {
    const key = designErrorMessageKey(previewUrl.error);
    stage = (
      <DesignErrorState
        message={localize(key === 'error_generic' ? 'workspace.preview.error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  } else {
    stage = (
      <DeviceFrame device={device} geometry={geometry}>
        {area.width > 0 && area.height > 0 ? (
          <iframe
            key={bridge.nonce}
            ref={bridge.frameRef}
            src={bridge.src}
            title={localize('workspace.preview.frame_title', { path })}
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy={PREVIEW_REFERRER_POLICY}
            loading="lazy"
            width={geometry.viewport.width}
            height={geometry.viewport.height}
            onLoad={() => setLoaded(true)}
            className="block size-full border-0 bg-white"
          />
        ) : null}
        {Overlay ? <Overlay {...context} /> : null}
        {loaded ? null : (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-surface-primary/60"
          >
            <Spinner className="size-5" />
            <span className="sr-only">{localize('workspace.preview.loading')}</span>
          </div>
        )}
      </DeviceFrame>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PreviewToolbar
        leading={leading}
        device={device}
        zoom={zoom}
        mode={extension.mode}
        modes={modes}
        openUrl={url}
        onDevice={setDevice}
        onZoom={setZoom}
        onMode={setMode}
        onRefresh={refresh}
        panel={
          drawer
            ? {
                open: drawerOpen,
                controls: panelId,
                label: localize(
                  drawerOpen ? 'workspace.preview.panel_hide' : 'workspace.preview.panel_show',
                  { mode: modeLabel },
                ),
                onToggle: () => setDrawerOpen((open) => !open),
              }
            : undefined
        }
      />
      <div
        ref={rowRef}
        data-testid="design-preview-area"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row"
      >
        <div
          ref={stageRef}
          data-testid="design-preview-stage"
          className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain bg-surface-secondary p-3 md:p-4"
        >
          {stage}
        </div>
        {Panel ? (
          <aside
            id={panelId}
            aria-label={modeLabel}
            data-testid="design-mode-panel"
            data-layout={panelLayout}
            hidden={drawer && !drawerOpen}
            className={cn(
              'min-h-0 overflow-auto bg-presentation',
              panelLayout === 'stacked' && 'max-h-[45%] shrink-0 border-t border-border-light',
              panelLayout === 'side' && 'w-80 shrink-0 border-l border-border-light',
              drawer &&
                'absolute inset-y-0 right-0 z-20 w-80 max-w-[calc(100%-3rem)] border-l border-border-light shadow-xl',
            )}
          >
            {drawer ? (
              <div className="flex items-center justify-end border-b border-border-light px-2 py-1">
                <button
                  type="button"
                  aria-label={localize('workspace.preview.panel_hide', { mode: modeLabel })}
                  title={localize('workspace.preview.panel_hide', { mode: modeLabel })}
                  onClick={() => setDrawerOpen(false)}
                  className={toolbarButton}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <Panel {...context} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
