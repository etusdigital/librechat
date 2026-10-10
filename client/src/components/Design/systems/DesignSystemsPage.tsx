import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from '@librechat/client';
import { ArrowLeft, Loader2, Palette, Search } from 'lucide-react';
import type { DesignMe, DesignSystemSummary } from '../api/types';
import type { SystemDefaults } from './SystemBadges';
import {
  systemDefaultsOf,
  useDebouncedValue,
  useGalleryParams,
  useInfiniteSentinel,
  useStableList,
} from './use-gallery';
import { useDesignProjectQuery, useDesignSystemQuery, useDesignSystemsQuery } from '../api/queries';
import { DesignCardsSkeleton, DesignEmptyState, DesignErrorState } from '../common/DesignStates';
import { DESIGN_HOME_PATH, designProjectPath, designSystemPath } from '../paths';
import { designErrorCode, designErrorMessageKey } from '../api/errors';
import DesignAccessGate from '../common/DesignAccessGate';
import DesignSystemCard from './DesignSystemCard';
import DesignPage from '../common/DesignPage';
import { useDesignLocalize } from '../i18n';

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4';

function GalleryControls({
  query,
  category,
  categories,
  onChange,
}: {
  query: string;
  category: string;
  categories: string[];
  onChange: (changes: Record<string, string>) => void;
}) {
  const localize = useDesignLocalize();
  const searchId = useId();
  const categoryId = useId();
  const [draft, setDraft] = useDebouncedValue(query, (value) => onChange({ q: value.trim() }));
  const options =
    category && !categories.includes(category) ? [category, ...categories] : categories;

  return (
    <div role="search" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label htmlFor={searchId} className="text-sm font-medium text-text-primary">
          {localize('systems.search_label')}
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={draft}
            maxLength={200}
            autoComplete="off"
            placeholder={localize('systems.search_placeholder')}
            onChange={(event) => setDraft(event.target.value)}
            className="h-10 w-full pl-9"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:w-64">
        <label htmlFor={categoryId} className="text-sm font-medium text-text-primary">
          {localize('systems.category_label')}
        </label>
        <select
          id={categoryId}
          value={category}
          onChange={(event) => onChange({ category: event.target.value })}
          className="h-10 w-full min-w-0 rounded-lg border border-border-light bg-surface-primary px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          <option value="">{localize('systems.category_all')}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ProjectContext({ projectId }: { projectId: string }) {
  const localize = useDesignLocalize();
  const { data: project } = useDesignProjectQuery(projectId);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border-light bg-surface-secondary p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm text-text-primary">
        {localize('systems.project_context', { name: project?.name ?? projectId })}
      </p>
      <Link
        to={designProjectPath(projectId)}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-medium text-text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary sm:self-auto"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {localize('systems.project_context_back')}
      </Link>
    </div>
  );
}

function FeaturedSystem({
  system,
  defaults,
  projectId,
}: {
  system: DesignSystemSummary;
  defaults: SystemDefaults;
  projectId: string | null;
}) {
  const localize = useDesignLocalize();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-sm font-medium text-text-primary">
        {localize('systems.featured_heading')}
      </h2>
      <ul className="grid grid-cols-1">
        <DesignSystemCard
          system={system}
          defaults={defaults}
          to={designSystemPath(system.id, { projectId })}
          featured
        />
      </ul>
    </section>
  );
}

function SystemGrid({
  systems,
  defaults,
  projectId,
}: {
  systems: DesignSystemSummary[];
  defaults: SystemDefaults;
  projectId: string | null;
}) {
  const localize = useDesignLocalize();
  return (
    <ul aria-label={localize('systems.list_label')} className={GRID}>
      {systems.map((system) => (
        <DesignSystemCard
          key={system.id}
          system={system}
          defaults={defaults}
          to={designSystemPath(system.id, { projectId })}
        />
      ))}
    </ul>
  );
}

function Gallery({ me }: { me: DesignMe }) {
  const localize = useDesignLocalize();
  const { query, category, projectId, update } = useGalleryParams();
  const defaults = systemDefaultsOf(me);
  const filtered = Boolean(query || category);
  const { data: featured } = useDesignSystemQuery(filtered ? '' : (defaults.company ?? ''));
  const { data, error, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useDesignSystemsQuery({ query, category });
  const all = useStableList(data?.pages);
  const systems = featured ? all.filter((system) => system.id !== featured.id) : all;
  const firstPage = data?.pages[0];
  const canLoadMore = Boolean(hasNextPage) && !isFetchingNextPage;
  const sentinel = useInfiniteSentinel(() => {
    fetchNextPage();
  }, canLoadMore);

  let body;
  if (isLoading) {
    body = <DesignCardsSkeleton label={localize('loading')} count={8} />;
  } else if (error && all.length === 0) {
    const key = designErrorMessageKey(error);
    const generic = key === 'error_generic' || designErrorCode(error) === null;
    body = (
      <DesignErrorState
        message={localize(generic ? 'systems.load_error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  } else if (all.length === 0) {
    body = (
      <div className="flex flex-1 flex-col gap-3">
        <DesignEmptyState icon={Palette} message={localize('systems.empty')} />
        {filtered ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-center"
            onClick={() => update({ q: '', category: '' })}
          >
            {localize('systems.clear_filters')}
          </Button>
        ) : null}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <SystemGrid systems={systems} defaults={defaults} projectId={projectId} />
        <div ref={sentinel} className="flex justify-center">
          {isFetchingNextPage ? (
            <span role="status" className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {localize('systems.loading_more')}
            </span>
          ) : null}
          {canLoadMore ? (
            <Button type="button" variant="outline" size="sm" onClick={() => fetchNextPage()}>
              {localize('systems.load_more')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {projectId ? <ProjectContext projectId={projectId} /> : null}
      <p className="text-sm text-text-secondary">{localize('systems.gallery_intro')}</p>
      <GalleryControls
        query={query}
        category={category}
        categories={firstPage?.categories ?? []}
        onChange={update}
      />
      {featured && !filtered ? (
        <FeaturedSystem system={featured} defaults={defaults} projectId={projectId} />
      ) : null}
      <section className="flex flex-1 flex-col gap-3">
        <p aria-live="polite" className="text-sm text-text-secondary">
          {firstPage ? localize('systems.results_count', { count: firstPage.total }) : null}
        </p>
        {body}
      </section>
    </div>
  );
}

export default function DesignSystemsPage() {
  const localize = useDesignLocalize();
  return (
    <DesignPage
      title={localize('systems_title')}
      back={{ to: DESIGN_HOME_PATH, label: localize('project_back') }}
    >
      <DesignAccessGate>{(me) => <Gallery me={me} />}</DesignAccessGate>
    </DesignPage>
  );
}
