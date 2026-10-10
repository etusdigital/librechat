import type { DesignMe, DesignTemplate, ProjectKind, TemplateKind } from '../api/types';
import { DESIGN_QUERY, designNewProjectPath } from '../paths';

export const NEW_PROJECT_KINDS = ['prototype', 'deck', 'doc', 'image', 'video'] as const;
export type NewProjectKind = (typeof NEW_PROJECT_KINDS)[number];

export const TEMPLATE_KIND_ORDER: readonly TemplateKind[] = ['prototype', 'deck', 'image'];

export const NEW_PROJECT_STEPS = ['kind', 'template', 'system', 'details'] as const;
export type NewProjectStep = (typeof NEW_PROJECT_STEPS)[number];

export const DEFAULT_DESIGN_SYSTEM_ID = 'etus';
export const PROJECT_NAME_MAX = 120;
export const BRIEF_MAX = 4000;

const CATALOG_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const TEMPLATE_ID = /^tpl-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NEW_PROJECT_QUERY_KEYS = [
  DESIGN_QUERY.newProject,
  DESIGN_QUERY.designSystem,
  DESIGN_QUERY.projectKind,
  DESIGN_QUERY.template,
] as const;

export interface NewProjectPreset {
  kind?: NewProjectKind;
  templateId?: string;
  designSystemId?: string;
}

export interface NewProjectDraft {
  kind: NewProjectKind;
  templateId: string | null;
  designSystemId: string;
  name: string;
  brief: string;
}

export function isNewProjectKind(value: unknown): value is NewProjectKind {
  return NEW_PROJECT_KINDS.includes(value as NewProjectKind);
}

export function templateKindOf(kind: ProjectKind): TemplateKind | null {
  return TEMPLATE_KIND_ORDER.includes(kind as TemplateKind) ? (kind as TemplateKind) : null;
}

export function templatesOfKind(templates: DesignTemplate[], kind: TemplateKind | null) {
  return kind ? templates.filter((template) => template.kind === kind) : templates;
}

export function templateKindsWithItems(templates: DesignTemplate[]): TemplateKind[] {
  const present = new Set(templates.map((template) => template.kind));
  return TEMPLATE_KIND_ORDER.filter((kind) => present.has(kind));
}

export function matchesSearch(text: string, search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return !needle || text.toLocaleLowerCase().includes(needle);
}

export function preferredDesignSystemId(me: DesignMe | undefined) {
  return me?.defaultDesignSystem || me?.companyDefaultDesignSystem || DEFAULT_DESIGN_SYSTEM_ID;
}

export function initialDraft(preset: NewProjectPreset, me: DesignMe | undefined): NewProjectDraft {
  return {
    kind: preset.kind ?? 'prototype',
    templateId: preset.templateId ?? null,
    designSystemId: preset.designSystemId ?? preferredDesignSystemId(me),
    name: '',
    brief: '',
  };
}

export function initialStep(preset: NewProjectPreset): NewProjectStep {
  return preset.templateId ? 'system' : 'kind';
}

export function readNewProjectPreset(search: URLSearchParams): NewProjectPreset | null {
  if (search.get(DESIGN_QUERY.newProject) !== '1') {
    return null;
  }
  const kind = search.get(DESIGN_QUERY.projectKind);
  const templateId = search.get(DESIGN_QUERY.template) ?? '';
  const designSystemId = search.get(DESIGN_QUERY.designSystem) ?? '';
  return {
    ...(isNewProjectKind(kind) ? { kind } : {}),
    ...(TEMPLATE_ID.test(templateId) ? { templateId } : {}),
    ...(CATALOG_ID.test(designSystemId) ? { designSystemId } : {}),
  };
}

export function withoutNewProjectParams(search: URLSearchParams) {
  const next = new URLSearchParams(search);
  for (const key of NEW_PROJECT_QUERY_KEYS) {
    next.delete(key);
  }
  return next;
}

export function newProjectHref(preset: NewProjectPreset = {}) {
  return designNewProjectPath(preset.designSystemId, {
    kind: preset.kind,
    templateId: preset.templateId,
  });
}

export function createProjectInput(draft: NewProjectDraft) {
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    designSystemId: draft.designSystemId,
    ...(draft.templateId ? { templateId: draft.templateId } : {}),
  };
}

export function isDraftReady(draft: NewProjectDraft) {
  const name = draft.name.trim();
  return name.length > 0 && name.length <= PROJECT_NAME_MAX && draft.brief.length <= BRIEF_MAX;
}
