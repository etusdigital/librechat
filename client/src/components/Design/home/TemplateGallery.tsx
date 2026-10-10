import { useMemo, useRef, useState } from 'react';
import { Check, Eye, FilePlus2, LayoutTemplate, Search } from 'lucide-react';
import {
  Button,
  Input,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogTitle,
  Skeleton,
} from '@librechat/client';
import type { DesignTemplate, TemplateKind } from '../api/types';
import { matchesSearch, templateKindsWithItems, templatesOfKind } from './new-project';
import { DesignEmptyState, DesignErrorState } from '../common/DesignStates';
import { useDesignTemplatesQuery } from '../api/queries';
import { designErrorMessageKey } from '../api/errors';
import { PROJECT_KIND_KEYS } from '../common/format';
import { PROJECT_KIND_ICONS } from './kind-icons';
import FrameThumbnail from './FrameThumbnail';
import { useDesignLocalize } from '../i18n';
import { useInView } from './use-in-view';
import { cn } from '~/utils';

export const TEMPLATE_PREVIEW_SANDBOX = 'allow-scripts';
const SEARCH_THRESHOLD = 8;

const chipClass = (active: boolean) =>
  cn(
    'h-9 shrink-0 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
    active
      ? 'border-border-xheavy bg-surface-active text-text-primary'
      : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  );

const cardClass = (selected: boolean) =>
  cn(
    'relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface-secondary transition-colors',
    selected ? 'border-border-xheavy ring-2 ring-text-primary' : 'border-border-light',
  );

function TemplateThumbnail({ template }: { template: DesignTemplate }) {
  const localize = useDesignLocalize();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const Icon = PROJECT_KIND_ICONS[template.kind] ?? LayoutTemplate;
  return (
    <div ref={ref}>
      <FrameThumbnail
        src={inView ? template.previewUrl : null}
        title={localize('home_template_thumbnail_title', { name: template.name })}
        fallback={
          <div className="flex h-full items-center justify-center text-text-secondary">
            <Icon className="size-8" strokeWidth={1.5} />
          </div>
        }
      />
    </div>
  );
}

function SelectedMark({ selected }: { selected: boolean }) {
  if (!selected) {
    return null;
  }
  return (
    <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-surface-inverted text-text-inverted">
      <Check className="size-4" aria-hidden="true" />
    </span>
  );
}

function BlankCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const localize = useDesignLocalize();
  return (
    <li className={cardClass(selected)}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex h-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
      >
        <span className="flex aspect-[16/10] w-full items-center justify-center bg-surface-tertiary text-text-secondary">
          <FilePlus2 className="size-8" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <span className="flex flex-col gap-1 p-3">
          <span className="text-sm font-semibold text-text-primary">
            {localize('home_template_blank')}
          </span>
          <span className="text-xs text-text-secondary">
            {localize('home_template_blank_description')}
          </span>
        </span>
      </button>
      <SelectedMark selected={selected} />
    </li>
  );
}

function TemplateCard({
  template,
  selected,
  onSelect,
  onPreview,
}: {
  template: DesignTemplate;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const localize = useDesignLocalize();
  return (
    <li className={cardClass(selected)}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex h-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-primary"
      >
        <TemplateThumbnail template={template} />
        <span className="flex min-w-0 flex-col gap-1 p-3 pb-12">
          <span className="truncate text-sm font-semibold text-text-primary">{template.name}</span>
          <span className="line-clamp-2 text-xs text-text-secondary">{template.description}</span>
        </span>
      </button>
      <SelectedMark selected={selected} />
      {template.previewUrl ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute bottom-2 left-3 h-8 bg-surface-secondary"
          aria-label={localize('home_template_preview_action', { name: template.name })}
          onClick={onPreview}
        >
          <Eye className="size-4" aria-hidden="true" />
          {localize('home_template_preview')}
        </Button>
      ) : null}
    </li>
  );
}

export function TemplatePreviewDialog({
  template,
  onOpenChange,
  onUse,
}: {
  template: DesignTemplate | null;
  onOpenChange: (open: boolean) => void;
  onUse?: (template: DesignTemplate) => void;
}) {
  const localize = useDesignLocalize();
  return (
    <OGDialog open={template !== null} onOpenChange={onOpenChange}>
      <OGDialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 rounded-none p-0 sm:h-[85vh] sm:max-h-[85vh] sm:w-[90vw] sm:max-w-5xl sm:rounded-2xl"
      >
        {template ? (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border-light p-4">
              <div className="min-w-0">
                <OGDialogTitle className="truncate text-base font-semibold text-text-primary">
                  {template.name}
                </OGDialogTitle>
                <OGDialogDescription className="line-clamp-2 text-sm text-text-secondary">
                  {template.description}
                </OGDialogDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onUse ? (
                  <Button type="button" size="sm" onClick={() => onUse(template)}>
                    {localize('home_template_use')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                >
                  {localize('home_close')}
                </Button>
              </div>
            </div>
            {template.previewUrl ? (
              <iframe
                src={template.previewUrl}
                title={localize('home_template_preview_title', { name: template.name })}
                sandbox={TEMPLATE_PREVIEW_SANDBOX}
                referrerPolicy="no-referrer"
                className="min-h-0 w-full flex-1 border-0 bg-surface-tertiary"
              />
            ) : null}
          </>
        ) : null}
      </OGDialogContent>
    </OGDialog>
  );
}

function GallerySkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div
        className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3"
        aria-hidden="true"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="overflow-hidden rounded-xl bg-surface-secondary">
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TemplateGallery({
  kind,
  selectedId,
  onSelect,
  showBlank = false,
  label,
}: {
  kind?: TemplateKind | null;
  selectedId?: string | null;
  onSelect: (template: DesignTemplate | null) => void;
  showBlank?: boolean;
  label: string;
}) {
  const localize = useDesignLocalize();
  const locked = kind !== undefined;
  const { data, error, isLoading, refetch } = useDesignTemplatesQuery();
  const [filter, setFilter] = useState<TemplateKind | null>(null);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<DesignTemplate | null>(null);

  const templates = useMemo(() => data ?? [], [data]);
  const kinds = useMemo(() => templateKindsWithItems(templates), [templates]);
  const filterKind = filter && kinds.includes(filter) ? filter : null;
  const activeKind = locked ? (kind ?? null) : filterKind;
  const ofKind = useMemo(
    () => (locked && !activeKind ? [] : templatesOfKind(templates, activeKind)),
    [locked, templates, activeKind],
  );
  const visible = useMemo(
    () =>
      ofKind.filter((template) =>
        matchesSearch(`${template.name} ${template.description}`, search),
      ),
    [ofKind, search],
  );

  if (isLoading) {
    return <GallerySkeleton label={localize('loading')} />;
  }
  if (error) {
    const key = designErrorMessageKey(error);
    return (
      <DesignErrorState
        message={localize(key === 'error_generic' ? 'home_templates_error' : key)}
        onRetry={() => {
          refetch();
        }}
      />
    );
  }

  const selectBlank = () => onSelect(null);
  const kindLabel = (value: TemplateKind) => localize(PROJECT_KIND_KEYS[value]);

  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-3">
      {!locked && kinds.length > 1 ? (
        <div
          role="group"
          aria-label={localize('home_template_filter')}
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          <button
            type="button"
            aria-pressed={activeKind === null}
            className={chipClass(activeKind === null)}
            onClick={() => setFilter(null)}
          >
            {localize('home_template_filter_all')}
          </button>
          {kinds.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeKind === value}
              className={chipClass(activeKind === value)}
              onClick={() => setFilter(value)}
            >
              {kindLabel(value)}
            </button>
          ))}
        </div>
      ) : null}
      {ofKind.length > SEARCH_THRESHOLD ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('home_template_search')}
            aria-label={localize('home_template_search')}
            className="pl-9"
          />
        </div>
      ) : null}
      {locked && ofKind.length === 0 ? (
        <p className="text-sm text-text-secondary">{localize('home_template_none_for_kind')}</p>
      ) : null}
      {visible.length === 0 && !showBlank && ofKind.length > 0 ? (
        <DesignEmptyState icon={LayoutTemplate} message={localize('home_template_no_match')} />
      ) : null}
      {visible.length === 0 && !showBlank && ofKind.length === 0 ? (
        <DesignEmptyState icon={LayoutTemplate} message={localize('home_template_none')} />
      ) : null}
      {visible.length > 0 || showBlank ? (
        <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
          {showBlank ? <BlankCard selected={!selectedId} onSelect={selectBlank} /> : null}
          {visible.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={selectedId === template.id}
              onSelect={() => onSelect(template)}
              onPreview={() => setPreview(template)}
            />
          ))}
        </ul>
      ) : null}
      {showBlank && visible.length === 0 && ofKind.length > 0 ? (
        <p className="text-sm text-text-secondary">{localize('home_template_no_match')}</p>
      ) : null}
      <TemplatePreviewDialog
        template={preview}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
          }
        }}
        onUse={(template) => {
          setPreview(null);
          onSelect(template);
        }}
      />
    </section>
  );
}
