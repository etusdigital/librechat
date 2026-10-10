import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Skeleton } from '@librechat/client';
import { ArrowRight, Check, Palette, Search } from 'lucide-react';
import type { DesignSystemSummary } from '../api/types';
import { DesignEmptyState, DesignErrorState } from '../common/DesignStates';
import { useDebouncedValue } from './use-debounced-value';
import { useDesignSystemsQuery } from '../api/queries';
import { designErrorMessageKey } from '../api/errors';
import { DESIGN_SYSTEMS_PATH } from '../paths';
import { SwatchDots } from './SystemSwatches';
import { useDesignLocalize } from '../i18n';
import { cn } from '~/utils';

const SEARCH_DEBOUNCE_MS = 250;

const chipClass = (active: boolean) =>
  cn(
    'h-9 shrink-0 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
    active
      ? 'border-border-xheavy bg-surface-active text-text-primary'
      : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  );

function SystemOption({
  system,
  selected,
  isDefault,
  onSelect,
}: {
  system: DesignSystemSummary;
  selected: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const localize = useDesignLocalize();
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
          selected
            ? 'border-border-xheavy bg-surface-active'
            : 'border-border-light bg-surface-secondary hover:bg-surface-hover',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-light bg-surface-primary text-lg font-semibold text-text-primary"
          style={system.headingFont ? { fontFamily: system.headingFont } : undefined}
        >
          {localize('home_system_specimen')}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{system.name}</span>
            {isDefault ? (
              <span className="shrink-0 rounded-full border border-border-medium px-1.5 text-[11px] text-text-secondary">
                {localize('home_system_default')}
              </span>
            ) : null}
          </span>
          <span className="truncate text-xs text-text-secondary">
            {system.inspiredBy
              ? `${system.category} · ${localize('home_system_inspired_by', { brand: system.inspiredBy })}`
              : system.category}
          </span>
          <SwatchDots system={system} />
        </span>
        {selected ? (
          <Check className="size-5 shrink-0 text-text-primary" aria-hidden="true" />
        ) : null}
      </button>
    </li>
  );
}

function PickerSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex items-center gap-3 rounded-xl bg-surface-secondary p-3"
        >
          <Skeleton className="size-11 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DesignSystemPicker({
  value,
  onChange,
  defaultId,
  selected,
}: {
  value: string;
  onChange: (system: DesignSystemSummary) => void;
  defaultId: string;
  selected: DesignSystemSummary | undefined;
}) {
  const localize = useDesignLocalize();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const query = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const { data, error, isLoading, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useDesignSystemsQuery({ query, category });

  const pageCategories = data?.pages[0]?.categories;
  useEffect(() => {
    if (pageCategories && pageCategories.length > 0) {
      setCategories(pageCategories);
    }
  }, [pageCategories]);

  const systems = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data?.pages]);

  let list: JSX.Element;
  if (isLoading) {
    list = <PickerSkeleton label={localize('loading')} />;
  } else if (error) {
    const key = designErrorMessageKey(error);
    list = (
      <DesignErrorState
        message={localize(key === 'error_generic' ? 'home_systems_error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  } else if (systems.length === 0) {
    list = <DesignEmptyState icon={Palette} message={localize('home_systems_empty')} />;
  } else {
    list = (
      <div className="flex flex-col gap-3">
        <ul aria-label={localize('home_systems_list')} className="flex flex-col gap-2">
          {systems.map((system) => (
            <SystemOption
              key={system.id}
              system={system}
              selected={system.id === value}
              isDefault={system.id === defaultId}
              onSelect={() => onChange(system)}
            />
          ))}
        </ul>
        {hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            className="self-center"
            disabled={isFetchingNextPage}
            onClick={() => {
              fetchNextPage();
            }}
          >
            {localize(isFetchingNextPage ? 'loading' : 'home_load_more')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border-light bg-surface-primary p-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-text-primary">
          <span className="text-text-secondary">{localize('home_system_selected')}</span>
          <span className="truncate font-semibold">{selected?.name ?? value}</span>
          <SwatchDots system={selected} />
        </span>
        <Link
          to={DESIGN_SYSTEMS_PATH}
          className="inline-flex items-center gap-1 text-sm text-text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary"
        >
          {localize('home_systems_gallery_link')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={localize('home_systems_search')}
          aria-label={localize('home_systems_search')}
          className="pl-9"
        />
      </div>
      {categories.length > 0 ? (
        <div
          role="group"
          aria-label={localize('home_systems_categories')}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          <button
            type="button"
            aria-pressed={category === ''}
            className={chipClass(category === '')}
            onClick={() => setCategory('')}
          >
            {localize('home_systems_category_all')}
          </button>
          {categories.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={category === name}
              className={chipClass(category === name)}
              onClick={() => setCategory(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {list}
    </div>
  );
}
