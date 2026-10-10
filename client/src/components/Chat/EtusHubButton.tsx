import { lazy, Suspense } from 'react';

const EtusHubLink = lazy(() => import('~/components/Etus/EtusHubLink'));

/**
 * Patch do fork (Etus): o seletor de apps do ETUS Platforms no cabeçalho, como nos outros apps
 * internos. O endereço do hub vem de VITE_ETUS_HUB_URL; sem ele o botão não aparece.
 */
export default function EtusHubButton() {
  const hubUrl = (import.meta.env.VITE_ETUS_HUB_URL ?? '').replace(/\/+$/, '');
  if (!hubUrl) {
    return null;
  }
  return (
    <Suspense fallback={<span className="inline-flex size-10" aria-hidden="true" />}>
      <EtusHubLink hubUrl={hubUrl} />
    </Suspense>
  );
}
