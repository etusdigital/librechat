import type { DesignMe, DesignProject, FileVersion, VersionSource } from '../../api/types';
import type { DesignTranslationKey } from '../../i18n';

export const COMPARE_MAX_BYTES = 512 * 1024;

export const VERSION_SOURCE_KEYS: Record<VersionSource, DesignTranslationKey> = {
  agent: 'actions.version_source_agent',
  inline_edit: 'actions.version_source_inline_edit',
  upload: 'actions.version_source_upload',
  restore: 'actions.version_source_restore',
  import: 'actions.version_source_import',
  media: 'actions.version_source_media',
};

export interface LineComparison {
  added: number;
  removed: number;
}

function splitLines(text: string) {
  return text.length === 0 ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

export function compareLines(current: string, candidate: string): LineComparison {
  const remaining = new Map<string, number>();
  for (const line of splitLines(current)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  let added = 0;
  for (const line of splitLines(candidate)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else {
      added += 1;
    }
  }
  let removed = 0;
  for (const count of remaining.values()) {
    removed += count;
  }
  return { added, removed };
}

export function isComparableText(version: Pick<FileVersion, 'mime' | 'size'>) {
  const textual =
    version.mime.startsWith('text/') ||
    ['application/json', 'application/javascript', 'image/svg+xml'].includes(version.mime);
  return textual && version.size <= COMPARE_MAX_BYTES;
}

export function isPreviewable(version: Pick<FileVersion, 'mime'>) {
  return version.mime === 'text/html';
}

export type VersionAuthor = { key: DesignTranslationKey } | { name: string };

export function versionAuthor(
  version: Pick<FileVersion, 'actorSub'>,
  me: Pick<DesignMe, 'sub'> | undefined,
  project: Pick<DesignProject, 'owner'>,
): VersionAuthor {
  if (me && version.actorSub === me.sub) {
    return { key: 'actions.version_author_you' };
  }
  if (version.actorSub === project.owner.sub && project.owner.name) {
    return { name: project.owner.name };
  }
  return { key: 'actions.version_author_other' };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
