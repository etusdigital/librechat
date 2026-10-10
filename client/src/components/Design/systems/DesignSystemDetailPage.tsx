import { useId, type ReactNode } from 'react';
import { ExternalLink, SearchX } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DesignMe, DesignSystemDetail } from '../api/types';
import { designErrorCode, designErrorMessageKey, isDesignApiError } from '../api/errors';
import { DESIGN_QUERY, designNewProjectPath, designSystemsPath } from '../paths';
import { DesignCardsSkeleton, DesignErrorState } from '../common/DesignStates';
import DesignAccessGate from '../common/DesignAccessGate';
import { useDesignSystemQuery } from '../api/queries';
import UseInProjectDialog from './UseInProjectDialog';
import UseAsDefaultDialog from './UseAsDefaultDialog';
import ComponentsPreview from './ComponentsPreview';
import { systemDefaultsOf } from './use-gallery';
import DesignPage from '../common/DesignPage';
import ColorSwatches from './ColorSwatches';
import { useDesignLocalize } from '../i18n';
import { useDesignAccess } from '../access';
import SystemBadges from './SystemBadges';
import TypeSpecimen from './TypeSpecimen';
import { safeHttpUrl } from './urls';

const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border-light bg-transparent px-4 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SystemHeader({ system, me }: { system: DesignSystemDetail; me: DesignMe }) {
  const localize = useDesignLocalize();
  const upstream = safeHttpUrl(system.attribution.originalUpstream);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
        <span>{system.category}</span>
        <SystemBadges system={system} defaults={systemDefaultsOf(me)} />
      </div>
      {system.summary ? (
        <p className="max-w-3xl text-base text-text-primary">{system.summary}</p>
      ) : null}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        <li>
          {system.license
            ? localize('systems.license', { license: system.license })
            : localize('systems.license_unknown')}
        </li>
        {system.attribution.origin ? (
          <li>{localize('systems.attribution_origin', { origin: system.attribution.origin })}</li>
        ) : null}
        {upstream ? (
          <li>
            <a
              href={upstream}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-text-secondary underline underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
            >
              {localize('systems.attribution_upstream')}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function SystemActions({
  system,
  me,
  projectId,
}: {
  system: DesignSystemDetail;
  me: DesignMe;
  projectId: string | null;
}) {
  const localize = useDesignLocalize();
  const isCompanyDefault = systemDefaultsOf(me).company === system.id;
  return (
    <div
      role="group"
      aria-label={localize('systems.actions_label')}
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      {projectId ? <UseInProjectDialog system={system} projectId={projectId} /> : null}
      <Link to={designNewProjectPath(system.id)} className={LINK_BUTTON}>
        {localize('systems.new_project')}
      </Link>
      {me.canSetCompanyDefault && !isCompanyDefault ? <UseAsDefaultDialog system={system} /> : null}
    </div>
  );
}

function SystemDetailBody({
  systemId,
  projectId,
  me,
}: {
  systemId: string;
  projectId: string | null;
  me: DesignMe;
}) {
  const localize = useDesignLocalize();
  const { data: system, error, isLoading, refetch } = useDesignSystemQuery(systemId);

  if (isLoading) {
    return <DesignCardsSkeleton label={localize('loading')} count={3} />;
  }
  if (error) {
    if (
      isDesignApiError(error) &&
      error.status === 404 &&
      designErrorCode(error) !== 'design_disabled'
    ) {
      return <DesignErrorState icon={SearchX} message={localize('systems.detail_not_found')} />;
    }
    const key = designErrorMessageKey(error);
    return (
      <DesignErrorState
        message={localize(key === 'error_generic' ? 'systems.detail_error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  }
  if (!system) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-col gap-10">
      <div className="flex flex-col gap-5">
        <SystemHeader system={system} me={me} />
        <SystemActions system={system} me={me} projectId={projectId} />
      </div>
      <Section title={localize('systems.colors_heading')}>
        <ColorSwatches colors={system.colors} />
      </Section>
      <Section title={localize('systems.typography_heading')}>
        <TypeSpecimen typography={system.typography} headingFont={system.headingFont} />
      </Section>
      <Section title={localize('systems.components_heading')}>
        <ComponentsPreview system={system} />
      </Section>
      {system.designMd ? (
        <Section title={localize('systems.rules_heading')}>
          <details className="group rounded-2xl border border-border-light bg-surface-secondary">
            <summary className="cursor-pointer rounded-2xl px-4 py-3 text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary">
              {localize('systems.rules_toggle')}
            </summary>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words border-t border-border-light px-4 py-3 font-sans text-sm text-text-primary">
              {system.designMd}
            </pre>
          </details>
        </Section>
      ) : null}
    </div>
  );
}

export default function DesignSystemDetailPage() {
  const localize = useDesignLocalize();
  const { systemId = '' } = useParams();
  const [params] = useSearchParams();
  const projectId = params.get(DESIGN_QUERY.project) || null;
  const { access } = useDesignAccess();
  const { data } = useDesignSystemQuery(systemId, { enabled: access.status === 'granted' });

  return (
    <DesignPage
      title={data?.name ?? localize('system_title_fallback')}
      back={{ to: designSystemsPath({ projectId }), label: localize('systems_back') }}
    >
      <DesignAccessGate>
        {(me) => <SystemDetailBody systemId={systemId} projectId={projectId} me={me} />}
      </DesignAccessGate>
    </DesignPage>
  );
}
