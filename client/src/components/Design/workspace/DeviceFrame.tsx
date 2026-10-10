import type { ReactNode } from 'react';
import type { PreviewGeometry } from './preview-geometry';
import type { DeviceId } from '../state/atoms';
import { cn } from '~/utils';

export default function DeviceFrame({
  device,
  geometry,
  children,
}: {
  device: DeviceId;
  geometry: PreviewGeometry;
  children: ReactNode;
}) {
  const { viewport, scale, frame } = geometry;
  return (
    <div
      data-testid="design-device-frame"
      data-device={device}
      data-viewport-width={viewport.width}
      data-viewport-height={viewport.height}
      data-scale={scale}
      style={{ width: frame.width, height: frame.height }}
      className={cn(
        'relative m-auto shrink-0 overflow-hidden bg-white',
        device === 'free' ? 'rounded-none' : 'rounded-xl border border-border-medium shadow-lg',
      )}
    >
      <div
        data-testid="design-device-viewport"
        className="relative origin-top-left"
        style={{
          width: viewport.width,
          height: viewport.height,
          transform: scale === 1 ? undefined : `scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
