import type { DesignTranslationKey } from '../i18n';
import type { ProjectKind } from '../api/types';

export const PROJECT_KIND_KEYS: Record<ProjectKind, DesignTranslationKey> = {
  prototype: 'project_kind_prototype',
  deck: 'project_kind_deck',
  doc: 'project_kind_doc',
  image: 'project_kind_image',
  video: 'project_kind_video',
  other: 'project_kind_other',
};

export function formatDesignDate(value: string | null | undefined, locale?: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
