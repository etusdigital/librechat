/*
 * Adapted from Open Design (https://github.com/nexu-io/open-design), commit
 * 802708f6c9f294347ef777b1fda49b9cbe26ef72, file apps/web/src/edit-mode/source-patches.ts,
 * licensed under the Apache License 2.0.
 * Modified by Etus Digital; see NOTICE.md and SOURCES.json.
 */
import type { EditableCssProperty } from '../../preview/host-protocol';
import {
  EDITABLE_CSS_PROPERTIES,
  SELECTOR_MAX,
  SNIPPET_MAX,
  TEXT_MAX,
  isSafeCssValue,
} from '../../preview/host-protocol';

export interface SourcePatch {
  selector: string;
  text?: string;
  styles?: Record<string, string>;
  expectedText?: string;
}

export type SourcePatchError =
  | 'parse_failed'
  | 'invalid_patch'
  | 'target_not_found'
  | 'target_ambiguous'
  | 'target_not_in_source'
  | 'target_changed'
  | 'text_not_editable'
  | 'verify_failed';

export type SourcePatchResult =
  | { ok: true; source: string }
  | { ok: false; error: SourcePatchError; selector?: string };

export interface SourceElement {
  tag: string;
  text: string;
  snippet: string;
  textEditable: boolean;
  styles: Partial<Record<EditableCssProperty, string>>;
}

export type SourceElementResult =
  | { ok: true; element: SourceElement }
  | { ok: false; error: SourcePatchError };

interface SourceAttribute {
  name: string;
  start: number;
  end: number;
}

interface SourceTag {
  name: string;
  start: number;
  nameEnd: number;
  end: number;
  attributes: SourceAttribute[];
}

interface SourceMap {
  tags: SourceTag[];
  markup: number[];
}

interface Prepared {
  doc: Document;
  map: SourceMap;
}

interface Located extends Prepared {
  element: Element;
  tag: SourceTag;
}

interface Edit {
  start: number;
  end: number;
  value: string;
}

const MARKER = 'data-etus-src';
const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);
const NOT_EDITABLE = /^(script|style|template|meta|link|title|noscript|base|head|html|body)$/;
const WHITESPACE = /[\t\n\f\r ]/;
const TAG_NAME_END = /[\t\n\f\r />]/;
const ATTRIBUTE_NAME_END = /[\t\n\f\r />=]/;
const LETTER = /[A-Za-z]/;
const LONGHANDS: Record<string, string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
  'border-color': [
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
  ],
  'border-width': [
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ],
  gap: ['row-gap', 'column-gap'],
};
const editable = new Set<string>(EDITABLE_CSS_PROPERTIES);

export function normalizeSnippet(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX);
}

function skipWhitespace(source: string, index: number) {
  let i = index;
  while (i < source.length && WHITESPACE.test(source[i])) {
    i += 1;
  }
  return i;
}

function readStartTag(source: string, start: number): SourceTag | null {
  let i = start + 1;
  while (i < source.length && !TAG_NAME_END.test(source[i])) {
    i += 1;
  }
  const tag: SourceTag = {
    name: source.slice(start + 1, i).toLowerCase(),
    start,
    nameEnd: i,
    end: -1,
    attributes: [],
  };
  while (i < source.length) {
    i = skipWhitespace(source, i);
    if (source[i] === '/') {
      i += 1;
      continue;
    }
    if (i >= source.length) {
      break;
    }
    if (source[i] === '>') {
      tag.end = i + 1;
      return tag;
    }
    const attributeStart = i;
    i += 1;
    while (i < source.length && !ATTRIBUTE_NAME_END.test(source[i])) {
      i += 1;
    }
    const name = source.slice(attributeStart, i).toLowerCase();
    const afterName = skipWhitespace(source, i);
    if (source[afterName] === '=') {
      i = skipWhitespace(source, afterName + 1);
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1);
        i = close < 0 ? source.length : close + 1;
      } else {
        while (i < source.length && !WHITESPACE.test(source[i]) && source[i] !== '>') {
          i += 1;
        }
      }
    }
    tag.attributes.push({ name, start: attributeStart, end: i });
  }
  return null;
}

function rawTextEnd(source: string, name: string, from: number) {
  if (name === 'plaintext') {
    return source.length;
  }
  const close = new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'ig');
  close.lastIndex = from;
  const match = close.exec(source);
  return match ? match.index : source.length;
}

function scanSource(source: string): SourceMap {
  const tags: SourceTag[] = [];
  const markup: number[] = [];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) {
      break;
    }
    const next = source[lt + 1];
    if (source.startsWith('<!--', lt)) {
      markup.push(lt);
      const close = source.indexOf('-->', lt + 4);
      i = close < 0 ? source.length : close + 3;
    } else if (next === '!' || next === '?' || next === '/') {
      markup.push(lt);
      const close = source.indexOf('>', lt + 2);
      i = close < 0 ? source.length : close + 1;
    } else if (next !== undefined && LETTER.test(next)) {
      const tag = readStartTag(source, lt);
      if (!tag) {
        break;
      }
      markup.push(lt);
      tags.push(tag);
      i = RAW_TEXT.has(tag.name) ? rawTextEnd(source, tag.name, tag.end) : tag.end;
    } else {
      i = lt + 1;
    }
  }
  return { tags, markup };
}

function parseHtml(source: string): Document | null {
  if (typeof DOMParser === 'undefined') {
    return null;
  }
  return new DOMParser().parseFromString(source, 'text/html');
}

function markSource(source: string, tags: SourceTag[]) {
  let marked = '';
  let last = 0;
  tags.forEach((tag, index) => {
    marked += `${source.slice(last, tag.nameEnd)} ${MARKER}="${index}"`;
    last = tag.nameEnd;
  });
  return marked + source.slice(last);
}

function queryUnique(doc: Document, selector: string): Element | SourcePatchError {
  let found: NodeListOf<Element>;
  try {
    found = doc.querySelectorAll(selector);
  } catch {
    return 'target_not_found';
  }
  if (found.length === 0) {
    return 'target_not_found';
  }
  if (found.length > 1) {
    return 'target_ambiguous';
  }
  const element = found[0];
  if (
    !doc.body ||
    element === doc.body ||
    !doc.body.contains(element) ||
    NOT_EDITABLE.test(element.tagName.toLowerCase())
  ) {
    return 'target_not_found';
  }
  return element;
}

function prepare(source: string): Prepared | null {
  const map = scanSource(source);
  const doc = parseHtml(markSource(source, map.tags));
  return doc ? { doc, map } : null;
}

function locate({ doc, map }: Prepared, selector: string): Located | SourcePatchError {
  const element = queryUnique(doc, selector);
  if (typeof element === 'string') {
    return element;
  }
  const marker = element.getAttribute(MARKER);
  const tag = marker === null ? undefined : map.tags[Number(marker)];
  if (
    !tag ||
    tag.name !== element.tagName.toLowerCase() ||
    doc.querySelectorAll(`[${MARKER}="${marker}"]`).length !== 1
  ) {
    return 'target_not_in_source';
  }
  return { doc, element, tag, map };
}

function hasOnlyText(element: Element) {
  return Array.from(element.childNodes).every((node) => node.nodeType === 3);
}

function textRange(map: SourceMap, tag: SourceTag, sourceLength: number) {
  let low = 0;
  let high = map.markup.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (map.markup[mid] < tag.end) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return { start: tag.end, end: low < map.markup.length ? map.markup[low] : sourceLength };
}

function decodeText(doc: Document, html: string) {
  const template = doc.createElement('template');
  template.innerHTML = html;
  return template.content.textContent ?? '';
}

function isTextEditable(located: Located, source: string) {
  const { element, tag, map, doc } = located;
  if (RAW_TEXT.has(tag.name) || !hasOnlyText(element)) {
    return false;
  }
  const range = textRange(map, tag, source.length);
  return decodeText(doc, source.slice(range.start, range.end)) === element.textContent;
}

function splitDeclarations(style: string) {
  const declarations: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const char of style) {
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      declarations.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  declarations.push(current.trim());
  return declarations.filter(Boolean);
}

function propertyOf(declaration: string) {
  const colon = declaration.indexOf(':');
  return colon < 0 ? '' : declaration.slice(0, colon).trim().toLowerCase();
}

function valueOf(declaration: string) {
  return declaration.slice(declaration.indexOf(':') + 1).trim();
}

function readInlineStyles(style: string) {
  const styles: Partial<Record<EditableCssProperty, string>> = {};
  splitDeclarations(style).forEach((declaration) => {
    const property = propertyOf(declaration);
    if (editable.has(property)) {
      styles[property as EditableCssProperty] = valueOf(declaration);
    }
  });
  return styles;
}

function mergeStyles(style: string, changes: Record<string, string>) {
  let declarations = splitDeclarations(style);
  for (const [property, value] of Object.entries(changes)) {
    const replaced = new Set([property, ...(LONGHANDS[property] ?? [])]);
    declarations = declarations.filter((declaration) => !replaced.has(propertyOf(declaration)));
    if (value !== '') {
      declarations.push(`${property}: ${value}`);
    }
  }
  return declarations.join('; ');
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isValidPatch(patch: SourcePatch) {
  if (
    typeof patch.selector !== 'string' ||
    patch.selector.length === 0 ||
    patch.selector.length > SELECTOR_MAX
  ) {
    return false;
  }
  if (
    patch.text !== undefined &&
    (typeof patch.text !== 'string' || patch.text.length > TEXT_MAX)
  ) {
    return false;
  }
  const styles = Object.entries(patch.styles ?? {});
  if (patch.text === undefined && styles.length === 0) {
    return false;
  }
  return styles.every(
    ([property, value]) =>
      editable.has(property) && typeof value === 'string' && isSafeCssValue(value.trim()),
  );
}

function mergePatches(patches: SourcePatch[]) {
  const bySelector = new Map<string, SourcePatch>();
  patches.forEach((patch) => {
    const current = bySelector.get(patch.selector);
    const styles = Object.fromEntries(
      Object.entries(patch.styles ?? {}).map(([property, value]) => [property, value.trim()]),
    );
    bySelector.set(patch.selector, {
      selector: patch.selector,
      expectedText: patch.expectedText ?? current?.expectedText,
      text: patch.text ?? current?.text,
      styles: { ...current?.styles, ...styles },
    });
  });
  return [...bySelector.values()];
}

function styleEdit(source: string, located: Located, changes: Record<string, string>): Edit {
  const { tag, element } = located;
  const attribute = tag.attributes.find(({ name }) => name === 'style');
  const merged = mergeStyles(element.getAttribute('style') ?? '', changes);
  if (!attribute) {
    return {
      start: tag.nameEnd,
      end: tag.nameEnd,
      value: merged ? ` style="${escapeAttribute(merged)}"` : '',
    };
  }
  if (merged) {
    return {
      start: attribute.start,
      end: attribute.end,
      value: `style="${escapeAttribute(merged)}"`,
    };
  }
  const start = WHITESPACE.test(source[attribute.start - 1] ?? '')
    ? attribute.start - 1
    : attribute.start;
  return { start, end: attribute.end, value: '' };
}

function textEdit(source: string, located: Located, text: string): Edit {
  const range = textRange(located.map, located.tag, source.length);
  const current = source.slice(range.start, range.end);
  const leading = /^[\t\n\f\r ]*/.exec(current)?.[0] ?? '';
  const trailing =
    leading.length === current.length ? '' : (/[\t\n\f\r ]*$/.exec(current)?.[0] ?? '');
  return { ...range, value: `${leading}${escapeText(text)}${trailing}` };
}

function expectedTextOf(source: string, located: Located, text: string) {
  const range = textRange(located.map, located.tag, source.length);
  const current = source.slice(range.start, range.end);
  const leading = /^[\t\n\f\r ]*/.exec(current)?.[0] ?? '';
  const trailing =
    leading.length === current.length ? '' : (/[\t\n\f\r ]*$/.exec(current)?.[0] ?? '');
  return `${leading}${text}${trailing}`.replace(/\r\n?/g, '\n');
}

function tagSequence(doc: Document) {
  return Array.from(doc.getElementsByTagName('*'))
    .map((element) => element.tagName)
    .join(' ');
}

function lastDeclaration(style: string, property: string) {
  const found = splitDeclarations(style).filter((item) => propertyOf(item) === property);
  return found.length ? valueOf(found[found.length - 1]) : '';
}

function verify(
  before: Document,
  patched: string,
  expectations: { selector: string; text?: string; styles: Record<string, string> }[],
) {
  const after = parseHtml(patched);
  if (!after || tagSequence(after) !== tagSequence(before)) {
    return false;
  }
  return expectations.every(({ selector, text, styles }) => {
    const element = queryUnique(after, selector);
    if (typeof element === 'string') {
      return false;
    }
    if (text !== undefined && element.textContent !== text) {
      return false;
    }
    const style = element.getAttribute('style') ?? '';
    return Object.entries(styles).every(
      ([property, value]) => lastDeclaration(style, property) === value,
    );
  });
}

export function readSourceElement(source: string, selector: string): SourceElementResult {
  if (typeof selector !== 'string' || !selector || selector.length > SELECTOR_MAX) {
    return { ok: false, error: 'invalid_patch' };
  }
  const prepared = prepare(source);
  if (!prepared) {
    return { ok: false, error: 'parse_failed' };
  }
  const located = locate(prepared, selector);
  if (typeof located === 'string') {
    return { ok: false, error: located };
  }
  const { element, tag } = located;
  const text = element.textContent ?? '';
  return {
    ok: true,
    element: {
      tag: tag.name,
      text: text.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''),
      snippet: normalizeSnippet(text),
      textEditable: isTextEditable(located, source),
      styles: readInlineStyles(element.getAttribute('style') ?? ''),
    },
  };
}

export function applySourcePatches(source: string, patches: SourcePatch[]): SourcePatchResult {
  const invalid = patches.find((patch) => !isValidPatch(patch));
  if (invalid) {
    return { ok: false, error: 'invalid_patch', selector: invalid.selector };
  }
  const prepared = prepare(source);
  const reference = parseHtml(source);
  if (!prepared || !reference) {
    return { ok: false, error: 'parse_failed' };
  }
  const edits: Edit[] = [];
  const expectations: { selector: string; text?: string; styles: Record<string, string> }[] = [];
  for (const patch of mergePatches(patches)) {
    const located = locate(prepared, patch.selector);
    if (typeof located === 'string') {
      return { ok: false, error: located, selector: patch.selector };
    }
    const { element } = located;
    if (
      patch.expectedText !== undefined &&
      normalizeSnippet(element.textContent ?? '') !== normalizeSnippet(patch.expectedText)
    ) {
      return { ok: false, error: 'target_changed', selector: patch.selector };
    }
    const styles = patch.styles ?? {};
    const expectation: (typeof expectations)[number] = { selector: patch.selector, styles };
    if (patch.text !== undefined) {
      if (!isTextEditable(located, source)) {
        return { ok: false, error: 'text_not_editable', selector: patch.selector };
      }
      edits.push(textEdit(source, located, patch.text));
      expectation.text = expectedTextOf(source, located, patch.text);
    }
    if (Object.keys(styles).length > 0) {
      edits.push(styleEdit(source, located, styles));
    }
    expectations.push(expectation);
  }
  let patched = source;
  edits
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .forEach((edit) => {
      patched = patched.slice(0, edit.start) + edit.value + patched.slice(edit.end);
    });
  if (!verify(reference, patched, expectations)) {
    return { ok: false, error: 'verify_failed' };
  }
  return { ok: true, source: patched };
}
