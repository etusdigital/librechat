import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useMediaQuery } from '@librechat/client';
import type { ReactNode } from 'react';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';

export default function DesignPage({
  title,
  back,
  actions,
  children,
}: {
  title: string;
  back?: { to: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  return (
    <main className="flex h-full min-h-0 flex-col overflow-auto bg-presentation text-text-primary">
      <header className="sticky top-0 z-10 border-b border-border-light bg-presentation">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 md:h-16 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {isSmallScreen ? <OpenSidebar className="size-9 shrink-0" /> : null}
            {back ? (
              <Link
                to={back.to}
                aria-label={back.label}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
              >
                <ArrowLeft className="size-5" aria-hidden="true" />
              </Link>
            ) : null}
            <h1 className="truncate text-lg font-semibold tracking-tight text-text-primary md:text-xl">
              {title}
            </h1>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      </header>
      <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col px-4 pb-10 pt-6 md:px-6 md:pt-8">
        {children}
      </div>
    </main>
  );
}
