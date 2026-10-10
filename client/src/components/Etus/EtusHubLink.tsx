import { Grip } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';

export default function EtusHubLink({ hubUrl }: { hubUrl: string }) {
  const localize = useLocalize();
  return (
    <TooltipAnchor
      description={localize('com_etus_apps')}
      render={
        <a
          href={`${hubUrl}/apps`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={localize('com_etus_apps')}
          className="inline-flex size-10 items-center justify-center rounded-lg border border-border-light text-text-primary transition-colors duration-200 hover:bg-surface-hover"
        >
          <Grip size={16} aria-hidden="true" />
        </a>
      }
    />
  );
}
