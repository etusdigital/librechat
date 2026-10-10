import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { Spinner } from '@librechat/client';
import type { ReactNode } from 'react';
import type { DesignMe, DesignProjectDetail } from '../api/types';
import { PREVIEW_REFERRER_POLICY, PREVIEW_SANDBOX } from '../preview/host-protocol';
import { deviceAtom, workspaceModeAtom, zoomAtom } from '../state/atoms';
import { usePreviewBridge } from '../preview/use-preview-bridge';
import { usePreviewUrlQuery } from '../api/workspace-queries';
import { DesignErrorState } from '../common/DesignStates';
import { availableModes, modeExtension } from './modes';
import { designErrorMessageKey } from '../api/errors';
import { isPreviewUrlFresh } from '../api/workspace';
import { previewGeometry } from './preview-geometry';
import { useElementSize } from './use-element-size';
import PreviewToolbar from './PreviewToolbar';
import { useDesignLocalize } from '../i18n';
import DeviceFrame from './DeviceFrame';

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
  const modes = availableModes();
  const extension = modeExtension(mode);
  const previewUrl = usePreviewUrlQuery({ projectId: project.projectId, path });
  const url = previewUrl.data?.url ?? null;
  const bridge = usePreviewBridge({ previewUrl: url, mode: extension.bridgeMode });
  const [loaded, setLoaded] = useState(false);
  const [stageRef, area] = useElementSize<HTMLDivElement>();
  const geometry = previewGeometry(device, zoom, area);
  const { reload } = bridge;
  const { refetch, data } = previewUrl;

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

  useEffect(() => {
    if (mode !== extension.mode) {
      setMode(extension.mode);
    }
  }, [extension.mode, mode, setMode]);

  const context = { project, me, path, device, geometry, bridge };
  const { Overlay, Panel } = extension;

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
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          ref={stageRef}
          data-testid="design-preview-stage"
          className="flex min-h-0 min-w-0 flex-1 overflow-auto bg-surface-secondary p-3 md:p-4"
        >
          {stage}
        </div>
        {Panel ? (
          <aside className="max-h-[45%] min-h-0 shrink-0 overflow-auto border-t border-border-light md:max-h-none md:w-80 md:border-l md:border-t-0">
            <Panel {...context} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
