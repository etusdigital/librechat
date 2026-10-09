import { Grip } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useLocalize } from '~/hooks';

/**
 * Patch do fork (Etus): o seletor de apps do ETUS Platforms no cabeçalho, como nos outros apps
 * internos. O endereço do hub vem de VITE_ETUS_HUB_URL; sem ele o botão não aparece.
 */
export default function EtusHubButton() {
  const localize = useLocalize();
  const hubUrl = (import.meta.env.VITE_ETUS_HUB_URL ?? '').replace(/\/+$/, '');
  if (!hubUrl) {
    return null;
  }

  return (
    <TooltipAnchor
      description={localize('com_etus_apps')}
      render={
        <a
          href={`${hubUrl}/apps`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={localize('com_etus_apps')}
          className="border-border-light text-text-primary hover:bg-surface-hover inline-flex size-10 items-center justify-center rounded-lg border transition-colors duration-200"
        >
          <Grip size={16} aria-hidden="true" />
        </a>
      }
    />
  );
}
