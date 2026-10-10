import { useId, useMemo, useState } from 'react';
import { Button, Spinner } from '@librechat/client';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, MousePointerClick } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EditableCssProperty } from '../../preview/host-protocol';
import type { InspectTarget, SourceStatus } from './inspect-session';
import type { TokenOption, TokenSuggestions } from './design-tokens';
import type { WorkspaceModeContext } from '../modes/types';
import type { DesignTranslationKey } from '../../i18n';
import ConfirmActionDialog from '../actions/ConfirmActionDialog';
import { useDesignSystemQuery } from '../../api/queries';
import { useInspectEditor } from './use-inspect-editor';
import InspectStyleField from './InspectStyleField';
import { tokenSuggestions } from './design-tokens';
import InspectConflict from './InspectConflict';
import { useDesignLocalize } from '../../i18n';
import { editFor } from './inspect-session';
import { cn } from '~/utils';

interface FieldSpec {
  property: EditableCssProperty;
  labelKey: DesignTranslationKey;
  computed?: string;
  options?: keyof TokenSuggestions;
  collapse?: boolean;
}

const SECTIONS: { titleKey: DesignTranslationKey; fields: FieldSpec[] }[] = [
  {
    titleKey: 'inspect.section_colors',
    fields: [
      {
        property: 'color',
        labelKey: 'inspect.field_color',
        computed: 'color',
        options: 'colors',
        collapse: true,
      },
      {
        property: 'background-color',
        labelKey: 'inspect.field_background',
        computed: 'backgroundColor',
        options: 'colors',
        collapse: true,
      },
      {
        property: 'border-color',
        labelKey: 'inspect.field_border_color',
        options: 'colors',
        collapse: true,
      },
    ],
  },
  {
    titleKey: 'inspect.section_typography',
    fields: [
      {
        property: 'font-size',
        labelKey: 'inspect.field_font_size',
        computed: 'fontSize',
        options: 'fontSize',
      },
      {
        property: 'font-weight',
        labelKey: 'inspect.field_font_weight',
        computed: 'fontWeight',
        options: 'fontWeight',
      },
      { property: 'line-height', labelKey: 'inspect.field_line_height', options: 'lineHeight' },
      {
        property: 'letter-spacing',
        labelKey: 'inspect.field_letter_spacing',
        options: 'letterSpacing',
      },
    ],
  },
  {
    titleKey: 'inspect.section_spacing',
    fields: [
      {
        property: 'margin',
        labelKey: 'inspect.field_margin',
        computed: 'margin',
        options: 'space',
        collapse: true,
      },
      {
        property: 'padding',
        labelKey: 'inspect.field_padding',
        computed: 'padding',
        options: 'space',
        collapse: true,
      },
      { property: 'gap', labelKey: 'inspect.field_gap', options: 'space', collapse: true },
      {
        property: 'border-radius',
        labelKey: 'inspect.field_radius',
        computed: 'borderRadius',
        options: 'radius',
      },
      { property: 'border-width', labelKey: 'inspect.field_border_width' },
      { property: 'opacity', labelKey: 'inspect.field_opacity' },
    ],
  },
];

const ALIGNMENTS: { value: string; icon: LucideIcon; labelKey: DesignTranslationKey }[] = [
  { value: 'left', icon: AlignLeft, labelKey: 'inspect.align_left' },
  { value: 'center', icon: AlignCenter, labelKey: 'inspect.align_center' },
  { value: 'right', icon: AlignRight, labelKey: 'inspect.align_right' },
  { value: 'justify', icon: AlignJustify, labelKey: 'inspect.align_justify' },
];

const UNAVAILABLE_KEYS: Record<
  Extract<SourceStatus, { state: 'unavailable' }>['reason'],
  DesignTranslationKey
> = {
  not_in_source: 'inspect.unavailable_source',
  dynamic: 'inspect.unavailable_dynamic',
  load_failed: 'inspect.unavailable_load',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      {children}
    </section>
  );
}

function TargetSummary({ target }: { target: InspectTarget }) {
  const localize = useDesignLocalize();
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-light px-3 py-2">
      <p className="flex min-w-0 items-center gap-2 text-sm text-text-primary">
        <code className="shrink-0 rounded border border-border-light px-1.5 py-0.5 text-xs">
          {`<${target.tag}>`}
        </code>
        <span className="truncate">{target.textSnippet || localize('inspect.target_no_text')}</span>
      </p>
      <p className="truncate font-mono text-xs text-text-secondary" title={target.selector}>
        {target.selector}
      </p>
    </div>
  );
}

export default function InspectPanel({ project, path, bridge }: WorkspaceModeContext) {
  const localize = useDesignLocalize();
  const headingId = useId();
  const textId = useId();
  const editor = useInspectEditor({ project, path, bridge });
  const designSystem = useDesignSystemQuery(project.designSystemId, {
    enabled: Boolean(project.designSystemId),
  });
  const tokens = useMemo(() => tokenSuggestions(designSystem.data), [designSystem.data]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { session, conflict, saving } = editor;
  const { target, source } = session;
  const edit = editFor(session.edits, target?.selector);
  const element = source?.state === 'ready' ? source.element : null;
  const locked = !project.canWrite || conflict || saving;
  const pending = session.edits.length;

  let status: string | null = null;
  if (pending > 0) {
    status = localize('inspect.pending', { count: pending });
  } else if (editor.savedVersion !== null) {
    status = localize('inspect.saved', { version: editor.savedVersion });
  }

  const styleValue = (property: EditableCssProperty) =>
    edit?.styles[property] ?? element?.styles[property] ?? '';

  let body: ReactNode;
  if (!target) {
    body = (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <MousePointerClick className="size-6 text-text-secondary" aria-hidden="true" />
        <p className="text-sm text-text-secondary">{localize('inspect.empty')}</p>
      </div>
    );
  } else if (!source || source.state === 'loading') {
    body = (
      <div role="status" className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="size-4" />
        {localize('inspect.loading_source')}
      </div>
    );
  } else if (source.state === 'unavailable') {
    body = (
      <p className="text-sm text-text-secondary">{localize(UNAVAILABLE_KEYS[source.reason])}</p>
    );
  } else if (element) {
    const fieldOptions = (spec: FieldSpec): TokenOption[] =>
      spec.options ? tokens[spec.options] : [];
    const align = styleValue('text-align');
    body = (
      <div className="flex flex-col gap-5">
        <Section title={localize('inspect.section_text')}>
          {element.textEditable ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={textId} className="text-xs font-medium text-text-secondary">
                {localize('inspect.field_text')}
              </label>
              <textarea
                id={textId}
                value={edit?.text ?? element.text}
                disabled={locked}
                rows={3}
                onChange={(event) => editor.setText(event.target.value)}
                className="w-full resize-y rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:opacity-50"
              />
            </div>
          ) : (
            <p className="text-xs text-text-secondary">{localize('inspect.text_nested')}</p>
          )}
        </Section>
        {SECTIONS.map((section) => (
          <Section key={section.titleKey} title={localize(section.titleKey)}>
            {section.fields.map((spec) => (
              <InspectStyleField
                key={`${target.selector}:${spec.property}`}
                property={spec.property}
                label={localize(spec.labelKey)}
                value={styleValue(spec.property)}
                placeholder={spec.computed ? target.computed[spec.computed] : undefined}
                options={fieldOptions(spec)}
                collapseOptions={spec.collapse}
                disabled={locked}
                onCommit={editor.setStyle}
              />
            ))}
            {section.titleKey === 'inspect.section_typography' ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-secondary">
                  {localize('inspect.field_align')}
                </span>
                <div
                  role="group"
                  aria-label={localize('inspect.field_align')}
                  className="flex gap-1"
                >
                  {ALIGNMENTS.map(({ value, icon: Icon, labelKey }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={align === value}
                      aria-label={localize(labelKey)}
                      title={localize(labelKey)}
                      disabled={locked}
                      onClick={() => editor.setStyle('text-align', align === value ? '' : value)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md border border-border-light text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary disabled:pointer-events-none disabled:opacity-50',
                        align === value && 'bg-surface-active text-text-primary',
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Section>
        ))}
      </div>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="inspect-panel"
      className="flex min-h-full flex-col"
    >
      <div className="flex flex-1 flex-col gap-4 p-3">
        <h2 id={headingId} className="text-sm font-semibold text-text-primary">
          {localize('inspect.title')}
        </h2>
        {project.canWrite ? null : (
          <p className="text-xs text-text-secondary">{localize('inspect.read_only')}</p>
        )}
        {conflict ? (
          <InspectConflict
            busy={saving}
            onReload={editor.reloadLatest}
            onApplyOverLatest={editor.applyOverLatest}
          />
        ) : null}
        {target ? <TargetSummary target={target} /> : null}
        {body}
      </div>
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border-light bg-presentation p-3">
        <div aria-live="polite" className="min-h-4 text-xs text-text-secondary">
          {status}
        </div>
        {editor.errorKey ? (
          <p role="alert" className="text-xs text-text-destructive">
            {localize(editor.errorKey)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={pending === 0 || saving}
            onClick={() => setConfirmDiscard(true)}
          >
            {localize('inspect.discard')}
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1"
            disabled={pending === 0 || locked}
            aria-busy={saving}
            onClick={() => {
              editor.save();
            }}
          >
            {saving ? <Spinner className="size-4" /> : null}
            {localize('inspect.save')}
          </Button>
        </div>
      </div>
      <ConfirmActionDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={localize('inspect.discard_title')}
        description={localize('inspect.discard_description')}
        confirmLabel={localize('inspect.discard')}
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          editor.discard();
        }}
      />
    </section>
  );
}
