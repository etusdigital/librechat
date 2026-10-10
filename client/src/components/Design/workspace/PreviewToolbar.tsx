import { ExternalLink, Maximize, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DeviceId, WorkspaceMode, ZoomLevel } from '../state/atoms';
import type { WorkspaceModeExtension } from './modes';
import type { DesignTranslationKey } from '../i18n';
import { DEVICES, ZOOM_LEVELS } from '../state/atoms';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

const DEVICE_OPTIONS: { id: DeviceId; icon: LucideIcon; labelKey: DesignTranslationKey }[] = [
  { id: 'mobile', icon: Smartphone, labelKey: 'workspace.preview.device_mobile' },
  { id: 'tablet', icon: Tablet, labelKey: 'workspace.preview.device_tablet' },
  { id: 'desktop', icon: Monitor, labelKey: 'workspace.preview.device_desktop' },
  { id: 'free', icon: Maximize, labelKey: 'workspace.preview.device_free' },
];

export const toolbarButton =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:pointer-events-none disabled:opacity-50';

const pressed = 'bg-surface-active text-text-primary';

export function zoomValue(zoom: ZoomLevel) {
  return zoom === 'fit' ? 'fit' : String(zoom);
}

export function parseZoom(value: string): ZoomLevel {
  return ZOOM_LEVELS.find((level) => zoomValue(level) === value) ?? 'fit';
}

export default function PreviewToolbar({
  leading,
  device,
  zoom,
  mode,
  modes,
  openUrl,
  onDevice,
  onZoom,
  onMode,
  onRefresh,
}: {
  leading?: ReactNode;
  device: DeviceId;
  zoom: ZoomLevel;
  mode: WorkspaceMode;
  modes: readonly WorkspaceModeExtension[];
  openUrl: string | null;
  onDevice: (device: DeviceId) => void;
  onZoom: (zoom: ZoomLevel) => void;
  onMode: (mode: WorkspaceMode) => void;
  onRefresh: () => void;
}) {
  const localize = useDesignLocalize();
  return (
    <div
      role="toolbar"
      aria-label={localize('workspace.preview.toolbar')}
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border-light bg-presentation px-2 py-1.5"
    >
      {leading}
      <div role="group" aria-label={localize('workspace.preview.device')} className="flex gap-0.5">
        {DEVICE_OPTIONS.map(({ id, icon: Icon, labelKey }) => {
          const preset = DEVICES[id];
          const label = preset
            ? localize('workspace.preview.device_size', {
                name: localize(labelKey),
                width: preset.width,
                height: preset.height,
              })
            : localize(labelKey);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={device === id}
              aria-label={label}
              title={label}
              onClick={() => onDevice(id)}
              className={cn(toolbarButton, device === id && pressed)}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <select
        aria-label={localize('workspace.preview.zoom')}
        value={zoomValue(zoom)}
        onChange={(event) => onZoom(parseZoom(event.target.value))}
        className="h-8 rounded-md border border-border-light bg-surface-primary px-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
      >
        {ZOOM_LEVELS.map((level) => (
          <option key={zoomValue(level)} value={zoomValue(level)}>
            {level === 'fit'
              ? localize('workspace.preview.zoom_fit')
              : localize('workspace.preview.zoom_percent', { value: Math.round(level * 100) })}
          </option>
        ))}
      </select>
      {modes.length > 1 ? (
        <div role="group" aria-label={localize('workspace.preview.mode')} className="flex gap-0.5">
          {modes.map(({ mode: id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              aria-label={localize(labelKey)}
              title={localize(labelKey)}
              onClick={() => onMode(id)}
              className={cn(toolbarButton, mode === id && pressed)}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="ml-auto flex gap-0.5">
        <button
          type="button"
          aria-label={localize('workspace.preview.refresh')}
          title={localize('workspace.preview.refresh')}
          onClick={onRefresh}
          className={toolbarButton}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </button>
        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            aria-label={localize('workspace.preview.open_tab')}
            title={localize('workspace.preview.open_tab')}
            className={toolbarButton}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-label={localize('workspace.preview.open_tab')}
            className={toolbarButton}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
