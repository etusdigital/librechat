import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '~/utils';

export const THUMBNAIL_VIEWPORT = { width: 1280, height: 800 } as const;
export const THUMBNAIL_SANDBOX = 'allow-scripts';

export default function FrameThumbnail({
  src,
  title,
  fallback,
  className,
}: {
  src: string | null;
  title: string;
  fallback?: ReactNode;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') {
      return;
    }
    const update = () => {
      const width = box.clientWidth;
      if (width > 0) {
        setScale(width / THUMBNAIL_VIEWPORT.width);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={boxRef}
      className={cn(
        'relative aspect-[16/10] w-full overflow-hidden bg-surface-tertiary',
        className ?? '',
      )}
    >
      <div aria-hidden="true" className="absolute inset-0">
        {fallback}
      </div>
      {src ? (
        <iframe
          src={src}
          title={title}
          tabIndex={-1}
          aria-hidden="true"
          sandbox={THUMBNAIL_SANDBOX}
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          style={{
            width: THUMBNAIL_VIEWPORT.width,
            height: THUMBNAIL_VIEWPORT.height,
            transform: `scale(${scale})`,
          }}
          className={cn(
            'pointer-events-none absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
    </div>
  );
}
