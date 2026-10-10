import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogTitle,
  Textarea,
} from '@librechat/client';
import type { DesignMe, DesignSystemSummary, DesignTemplate } from '../api/types';
import {
  BRIEF_MAX,
  NEW_PROJECT_KINDS,
  NEW_PROJECT_STEPS,
  PROJECT_NAME_MAX,
  createProjectInput,
  initialDraft,
  initialStep,
  isDraftReady,
  isNewProjectKind,
  preferredDesignSystemId,
  templateKindOf,
  type NewProjectDraft,
  type NewProjectKind,
  type NewProjectPreset,
  type NewProjectStep,
} from './new-project';
import { useCreateDesignProjectMutation, useDesignTemplatesQuery } from '../api/queries';
import { useDesignLocalize, type DesignTranslationKey } from '../i18n';
import { designErrorCode, designErrorMessageKey } from '../api/errors';
import { useDesignSystemDirectory } from '../api/home-queries';
import { useSetPendingBrief } from '../state/pending-brief';
import DesignSystemPicker from './DesignSystemPicker';
import { PROJECT_KIND_KEYS } from '../common/format';
import { PROJECT_KIND_ICONS } from './kind-icons';
import TemplateGallery from './TemplateGallery';
import { designProjectPath } from '../paths';
import { cn } from '~/utils';

const STEP_KEYS: Record<NewProjectStep, DesignTranslationKey> = {
  kind: 'home_new_step_kind',
  template: 'home_new_step_template',
  system: 'home_new_step_system',
  details: 'home_new_step_details',
};

const KIND_DESCRIPTION_KEYS: Record<NewProjectKind, DesignTranslationKey> = {
  prototype: 'home_new_kind_prototype_description',
  deck: 'home_new_kind_deck_description',
  doc: 'home_new_kind_doc_description',
  image: 'home_new_kind_image_description',
  video: 'home_new_kind_video_description',
};

const CREATE_ERROR_KEYS: Record<string, DesignTranslationKey> = {
  too_many_projects: 'home_create_error_limit',
  design_system_not_found: 'home_create_error_system',
  invalid_input: 'home_create_error_invalid',
};

export function createErrorKey(error: unknown): DesignTranslationKey {
  const code = designErrorCode(error);
  if (code && CREATE_ERROR_KEYS[code]) {
    return CREATE_ERROR_KEYS[code];
  }
  const key = designErrorMessageKey(error);
  return key === 'error_generic' ? 'home_create_error' : key;
}

function KindStep({
  value,
  onChange,
}: {
  value: NewProjectKind;
  onChange: (kind: NewProjectKind) => void;
}) {
  const localize = useDesignLocalize();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{localize('home_new_step_kind')}</legend>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {NEW_PROJECT_KINDS.map((kind) => {
          const Icon = PROJECT_KIND_ICONS[kind];
          const checked = kind === value;
          return (
            <label
              key={kind}
              className={cn(
                'relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-text-primary',
                checked
                  ? 'border-border-xheavy bg-surface-active'
                  : 'border-border-light bg-surface-secondary hover:bg-surface-hover',
              )}
            >
              <input
                type="radio"
                name="design-project-kind"
                value={kind}
                checked={checked}
                onChange={() => onChange(kind)}
                className="sr-only"
              />
              <Icon className="mt-0.5 size-5 shrink-0 text-text-primary" aria-hidden="true" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-text-primary">
                  {localize(PROJECT_KIND_KEYS[kind])}
                </span>
                <span className="text-xs text-text-secondary">
                  {localize(KIND_DESCRIPTION_KEYS[kind])}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DetailsStep({
  draft,
  onChange,
  templateName,
  system,
}: {
  draft: NewProjectDraft;
  onChange: (patch: Partial<NewProjectDraft>) => void;
  templateName: string;
  system: DesignSystemSummary | undefined;
}) {
  const localize = useDesignLocalize();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <dl className="grid grid-cols-1 gap-2 rounded-xl border border-border-light bg-surface-primary p-3 text-sm min-[420px]:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-text-secondary">{localize('home_new_summary_kind')}</dt>
          <dd className="truncate text-text-primary">{localize(PROJECT_KIND_KEYS[draft.kind])}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-text-secondary">{localize('home_new_summary_template')}</dt>
          <dd className="truncate text-text-primary">{templateName}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-text-secondary">{localize('home_new_summary_system')}</dt>
          <dd className="truncate text-text-primary">{system?.name ?? draft.designSystemId}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <Label htmlFor="design-project-name">{localize('home_new_name')}</Label>
        <Input
          id="design-project-name"
          value={draft.name}
          maxLength={PROJECT_NAME_MAX}
          required
          ref={nameRef}
          autoComplete="off"
          placeholder={localize('home_new_name_placeholder')}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="design-project-brief">{localize('home_new_brief')}</Label>
        <Textarea
          id="design-project-brief"
          value={draft.brief}
          maxLength={BRIEF_MAX}
          rows={5}
          aria-describedby="design-project-brief-hint"
          placeholder={localize('home_new_brief_placeholder')}
          onChange={(event) => onChange({ brief: event.target.value })}
        />
        <p id="design-project-brief-hint" className="text-xs text-text-secondary">
          {localize('home_new_brief_hint')}
        </p>
      </div>
    </div>
  );
}

function NewProjectForm({
  onClose,
  me,
  preset,
}: {
  onClose: () => void;
  me: DesignMe;
  preset: NewProjectPreset;
}) {
  const localize = useDesignLocalize();
  const navigate = useNavigate();
  const setPendingBrief = useSetPendingBrief();
  const createProject = useCreateDesignProjectMutation();
  const { data: templates } = useDesignTemplatesQuery();
  const directory = useDesignSystemDirectory();
  const [draft, setDraft] = useState<NewProjectDraft>(() => initialDraft(preset, me));
  const [step, setStep] = useState<NewProjectStep>(() => initialStep(preset));
  const [pickedSystem, setPickedSystem] = useState<DesignSystemSummary | undefined>();

  const template = useMemo(
    () => templates?.find((item) => item.id === draft.templateId),
    [templates, draft.templateId],
  );

  useEffect(() => {
    if (template && !preset.kind && isNewProjectKind(template.kind)) {
      setDraft((current) =>
        current.kind === template.kind ? current : { ...current, kind: template.kind },
      );
    }
  }, [template, preset.kind]);

  const system =
    pickedSystem?.id === draft.designSystemId ? pickedSystem : directory.get(draft.designSystemId);
  const update = (patch: Partial<NewProjectDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const changeKind = (kind: NewProjectKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      templateId:
        current.templateId && template && template.kind !== kind ? null : current.templateId,
    }));

  const stepIndex = NEW_PROJECT_STEPS.indexOf(step);
  const isLast = stepIndex === NEW_PROJECT_STEPS.length - 1;
  const ready = isDraftReady(draft);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isLast) {
      setStep(NEW_PROJECT_STEPS[stepIndex + 1]);
      return;
    }
    if (!ready || createProject.isLoading) {
      return;
    }
    createProject.mutate(createProjectInput(draft), {
      onSuccess: (project) => {
        setPendingBrief(project.projectId, draft.brief);
        onClose();
        navigate(designProjectPath(project.projectId));
      },
    });
  };

  const back = () => {
    if (stepIndex === 0) {
      onClose();
      return;
    }
    setStep(NEW_PROJECT_STEPS[stepIndex - 1]);
  };

  const pickTemplate = (picked: DesignTemplate | null) =>
    update({ templateId: picked?.id ?? null });

  let body: JSX.Element;
  switch (step) {
    case 'kind':
      body = <KindStep value={draft.kind} onChange={changeKind} />;
      break;
    case 'template':
      body = (
        <TemplateGallery
          kind={templateKindOf(draft.kind)}
          selectedId={draft.templateId}
          onSelect={pickTemplate}
          showBlank
          label={localize('home_new_step_template')}
        />
      );
      break;
    case 'system':
      body = (
        <DesignSystemPicker
          value={draft.designSystemId}
          defaultId={preferredDesignSystemId(me)}
          selected={system}
          onChange={(picked) => {
            setPickedSystem(picked);
            update({ designSystemId: picked.id });
          }}
        />
      );
      break;
    default:
      body = (
        <DetailsStep
          draft={draft}
          onChange={update}
          templateName={template?.name ?? localize('home_template_blank')}
          system={system}
        />
      );
  }

  const error = createProject.error;

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border-light p-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <OGDialogTitle className="text-lg font-semibold text-text-primary">
              {localize('home_new_title')}
            </OGDialogTitle>
            <OGDialogDescription className="text-sm text-text-secondary">
              {localize('home_new_progress', {
                current: stepIndex + 1,
                total: NEW_PROJECT_STEPS.length,
                step: localize(STEP_KEYS[step]),
              })}
            </OGDialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={localize('home_close')}
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
        <ol className="grid grid-cols-4 gap-1.5" aria-hidden="true">
          {NEW_PROJECT_STEPS.map((item, index) => (
            <li
              key={item}
              className={cn(
                'h-1 rounded-full',
                index <= stepIndex ? 'bg-text-primary' : 'bg-border-medium',
              )}
            />
          ))}
        </ol>
      </div>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:px-6">
          <h3 className="mb-3 text-sm font-medium text-text-primary">
            {localize(STEP_KEYS[step])}
          </h3>
          {body}
        </div>
        {error ? (
          <p
            role="alert"
            className="border-t border-border-light px-4 py-2 text-sm text-text-destructive sm:px-6"
          >
            {localize(createErrorKey(error))}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-t border-border-light p-4 sm:px-6">
          <Button type="button" variant="outline" onClick={back}>
            {localize(stepIndex === 0 ? 'home_cancel' : 'home_back')}
          </Button>
          <Button
            type="submit"
            disabled={isLast && (!ready || createProject.isLoading)}
            aria-busy={createProject.isLoading}
          >
            {createProject.isLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {localize(isLast ? 'home_new_create' : 'home_next')}
          </Button>
        </div>
      </form>
    </>
  );
}

export default function NewProjectDialog({
  open,
  onOpenChange,
  me,
  preset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: DesignMe;
  preset: NewProjectPreset;
}) {
  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(90vh,52rem)] sm:max-h-[90vh] sm:w-[90vw] sm:max-w-3xl sm:rounded-2xl"
      >
        <NewProjectForm me={me} preset={preset} onClose={() => onOpenChange(false)} />
      </OGDialogContent>
    </OGDialog>
  );
}
