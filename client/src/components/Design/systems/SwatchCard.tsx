import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

export default function SwatchCard({
  swatches,
  headingFont,
  className,
}: {
  swatches: string[];
  headingFont: string | null;
  className?: string;
}) {
  const localize = useDesignLocalize();
  return (
    <div aria-hidden="true" className={cn('flex size-full flex-col bg-surface-primary', className)}>
      <div className="flex flex-1">
        {swatches.length > 0 ? (
          swatches.map((color, index) => (
            <span key={`${color}-${index}`} className="flex-1" style={{ background: color }} />
          ))
        ) : (
          <span className="flex-1 bg-surface-tertiary" />
        )}
      </div>
      <span
        className="truncate px-3 py-2 text-2xl font-semibold leading-none text-text-primary"
        style={headingFont ? { fontFamily: headingFont } : undefined}
      >
        {localize('systems.sample_glyphs')}
      </span>
    </div>
  );
}
