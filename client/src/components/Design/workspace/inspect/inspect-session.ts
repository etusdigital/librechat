import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { EditableCssProperty, HostCommand, InspectPatch } from '../../preview/host-protocol';
import type { SourceElement, SourcePatch } from '../../vendor/open-design/source-patches';
import { sanitizeStyles } from '../../preview/host-protocol';

export type InspectStyles = Partial<Record<EditableCssProperty, string>>;

export interface InspectEdit {
  selector: string;
  expectedText: string;
  original: { text: string; styles: InspectStyles };
  text?: string;
  styles: InspectStyles;
}

export interface InspectBase {
  source: string;
  etag: string;
  sha256: string;
  version: number | null;
}

export interface InspectTarget {
  selector: string;
  tag: string;
  textSnippet: string;
  computed: Record<string, string>;
}

export type SourceStatus =
  | { state: 'loading' }
  | { state: 'ready'; element: SourceElement }
  | { state: 'unavailable'; reason: 'not_in_source' | 'dynamic' | 'load_failed' };

export interface InspectSession {
  base: InspectBase | null;
  edits: InspectEdit[];
  target: InspectTarget | null;
  source: SourceStatus | null;
  conflict: boolean;
}

export const EMPTY_SESSION: InspectSession = {
  base: null,
  edits: [],
  target: null,
  source: null,
  conflict: false,
};

export const inspectSessionKey = (projectId: string, path: string) =>
  JSON.stringify([projectId, path]);

export const inspectSessionAtomFamily = atomFamily((_key: string) =>
  atom<InspectSession>(EMPTY_SESSION),
);

export function shaOfEtag(etag: string | null | undefined) {
  if (!etag) {
    return null;
  }
  const value = etag
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1')
    .toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function withoutEmpty(edit: InspectEdit): InspectEdit | null {
  return edit.text === undefined && Object.keys(edit.styles).length === 0 ? null : edit;
}

function upsert(
  edits: InspectEdit[],
  selector: string,
  create: () => InspectEdit,
  update: (edit: InspectEdit) => InspectEdit,
) {
  const index = edits.findIndex((edit) => edit.selector === selector);
  const next = withoutEmpty(update(index < 0 ? create() : edits[index]));
  if (index < 0) {
    return next ? [...edits, next] : edits;
  }
  return next
    ? edits.map((edit, position) => (position === index ? next : edit))
    : edits.filter((_, position) => position !== index);
}

export function newEdit(selector: string, element: SourceElement): InspectEdit {
  return {
    selector,
    expectedText: element.snippet,
    original: { text: element.text, styles: element.styles },
    styles: {},
  };
}

export function setEditText(
  edits: InspectEdit[],
  selector: string,
  create: () => InspectEdit,
  text: string,
) {
  return upsert(edits, selector, create, (edit) => {
    if (text === edit.original.text) {
      const { text: _removed, ...rest } = edit;
      return rest;
    }
    return { ...edit, text };
  });
}

export function setEditStyle(
  edits: InspectEdit[],
  selector: string,
  create: () => InspectEdit,
  property: EditableCssProperty,
  value: string,
) {
  const trimmed = value.trim();
  return upsert(edits, selector, create, (edit) => {
    const styles = { ...edit.styles };
    if (trimmed === (edit.original.styles[property] ?? '')) {
      delete styles[property];
    } else {
      styles[property] = trimmed;
    }
    return { ...edit, styles };
  });
}

export function editFor(edits: InspectEdit[], selector: string | undefined) {
  return selector ? edits.find((edit) => edit.selector === selector) : undefined;
}

export function editsToPatches(edits: InspectEdit[]): SourcePatch[] {
  return edits.map((edit) => ({
    selector: edit.selector,
    expectedText: edit.expectedText,
    ...(edit.text === undefined ? {} : { text: edit.text }),
    ...(Object.keys(edit.styles).length ? { styles: { ...edit.styles } } : {}),
  }));
}

export function liveCommandsFor(edits: InspectEdit[]): HostCommand[] {
  return edits.map((edit) => {
    const styles = sanitizeStyles(edit.styles);
    return {
      type: 'etus:inspect-set',
      selector: edit.selector,
      ...(edit.text === undefined ? {} : { text: edit.text }),
      ...(Object.keys(edit.styles).length ? { styles } : {}),
    };
  });
}

export function reconcileFramePatches(edits: InspectEdit[], framePatches: InspectPatch[] | null) {
  const own = new Map(edits.map((edit) => [edit.selector, edit]));
  const frame = new Map((framePatches ?? []).map((patch) => [patch.selector, patch]));
  const ignored = (framePatches ?? []).filter((patch) => !own.has(patch.selector)).length;
  const confirmed = edits
    .map((edit): InspectEdit | null => {
      const reported = frame.get(edit.selector);
      if (!framePatches || !reported) {
        return edit;
      }
      const styles: InspectStyles = {};
      (Object.entries(edit.styles) as [EditableCssProperty, string][]).forEach(
        ([property, value]) => {
          if (reported.styles?.[property] === value) {
            styles[property] = value;
          }
        },
      );
      const keepText = edit.text !== undefined && reported.text === edit.text;
      const { text: _text, ...rest } = edit;
      return withoutEmpty({ ...rest, ...(keepText ? { text: edit.text } : {}), styles });
    })
    .filter((edit): edit is InspectEdit => edit !== null);
  return { edits: confirmed, ignored };
}

export function isBaseStale(base: InspectBase | null, currentSha: string | undefined) {
  return Boolean(base && currentSha && currentSha.toLowerCase() !== base.sha256);
}
