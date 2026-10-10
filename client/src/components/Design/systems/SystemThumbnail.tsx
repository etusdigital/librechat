import { useState } from 'react';
import type { DesignSystemSummary } from '../api/types';
import SwatchCard from './SwatchCard';
import { safeHttpUrl } from './urls';
import { cn } from '~/utils';

type ImageState = 'loading' | 'loaded' | 'failed';

export default function SystemThumbnail({
  system,
}: {
  system: Pick<DesignSystemSummary, 'thumbnailUrl' | 'swatches' | 'headingFont'>;
}) {
  const src = safeHttpUrl(system.thumbnailUrl);
  const [state, setState] = useState<ImageState>('loading');
  const showImage = src !== null && state !== 'failed';

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border-light bg-surface-primary">
      <SwatchCard swatches={system.swatches} headingFont={system.headingFont} />
      {showImage ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          data-state={state}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(
            'absolute inset-0 size-full object-cover object-top transition-opacity duration-300',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
    </div>
  );
}
