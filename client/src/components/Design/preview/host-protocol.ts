import { z } from 'zod';

export const BRIDGE_MESSAGE_PREFIX = 'etus:';
export const BRIDGE_QUERY_PARAM = 'bridge';
export const BRIDGE_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const PREVIEW_FRAME_ORIGIN = 'null';
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups';
export const PREVIEW_REFERRER_POLICY = 'no-referrer';
export const BRIDGE_PREVIEW_MODES = ['view', 'comment', 'inspect'] as const;
export const EDITABLE_CSS_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-radius',
  'border-color',
  'border-width',
  'opacity',
  'gap',
] as const;
export const UNSAFE_CSS_VALUE = /[;{}<>\\\r\n]|url\s*\(|expression\s*\(|javascript:|@import/i;

export const SELECTOR_MAX = 1000;
export const TEXT_MAX = 10_000;
export const CSS_VALUE_MAX = 200;
export const SNIPPET_MAX = 200;
export const PATCHES_MAX = 500;

const NONCE_BYTES = 24;

export type EditableCssProperty = (typeof EDITABLE_CSS_PROPERTIES)[number];
export type BridgePreviewMode = (typeof BRIDGE_PREVIEW_MODES)[number];

const editableProperties = new Set<string>(EDITABLE_CSS_PROPERTIES);

export function isSafeCssValue(value: string) {
  return value.length <= CSS_VALUE_MAX && !UNSAFE_CSS_VALUE.test(value);
}

const Nonce = z.string().regex(BRIDGE_NONCE_PATTERN);
const Selector = z.string().min(1).max(SELECTOR_MAX);
const Styles = z
  .record(z.string(), z.string())
  .refine((styles) =>
    Object.entries(styles).every(
      ([name, value]) => editableProperties.has(name) && isSafeCssValue(value),
    ),
  );
const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).strict();
const Tag = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const InspectPatch = z
  .object({
    selector: Selector,
    text: z.string().max(TEXT_MAX).optional(),
    styles: Styles.optional(),
  })
  .strict();

export const HostMessage = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('etus:mode'), nonce: Nonce, mode: z.enum(BRIDGE_PREVIEW_MODES) })
    .strict(),
  z.object({ type: z.literal('etus:highlight'), nonce: Nonce, selector: Selector }).strict(),
  z
    .object({
      type: z.literal('etus:inspect-set'),
      nonce: Nonce,
      selector: Selector,
      text: z.string().max(TEXT_MAX).optional(),
      styles: Styles.optional(),
    })
    .strict(),
  z.object({ type: z.literal('etus:inspect-extract'), nonce: Nonce }).strict(),
  z.object({ type: z.literal('etus:inspect-reset'), nonce: Nonce }).strict(),
]);

export const FrameMessage = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('etus:ready'),
      nonce: Nonce,
      title: z.string().max(200),
      docHeight: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('etus:hover'),
      nonce: Nonce,
      selector: Selector,
      rect: Rect,
      tag: Tag,
    })
    .strict(),
  z
    .object({
      type: z.literal('etus:target'),
      nonce: Nonce,
      selector: Selector,
      textSnippet: z.string().max(SNIPPET_MAX),
      rect: Rect,
      tag: Tag,
      computed: z
        .object({
          color: z.string(),
          backgroundColor: z.string(),
          fontSize: z.string(),
          fontWeight: z.string(),
          textAlign: z.string(),
          margin: z.string(),
          padding: z.string(),
          borderRadius: z.string(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('etus:inspect-patches'),
      nonce: Nonce,
      patches: z.array(InspectPatch).max(PATCHES_MAX),
    })
    .strict(),
  z
    .object({
      type: z.literal('etus:error'),
      nonce: Nonce,
      message: z.string().max(500),
      source: z.string().max(300),
      line: z.number().int().nonnegative(),
    })
    .strict(),
]);

export type HostMessage = z.infer<typeof HostMessage>;
export type FrameMessage = z.infer<typeof FrameMessage>;
export type InspectPatch = z.infer<typeof InspectPatch>;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type HostCommand = DistributiveOmit<HostMessage, 'nonce'>;

export function createBridgeNonce(random: Crypto = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(NONCE_BYTES));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isBridgeNonce(value: unknown): value is string {
  return typeof value === 'string' && BRIDGE_NONCE_PATTERN.test(value);
}

export function previewFrameSrc(previewUrl: string, nonce: string) {
  if (!isBridgeNonce(nonce)) {
    throw new Error('invalid bridge nonce');
  }
  const [withoutHash, hash] = previewUrl.split('#', 2);
  const separator = withoutHash.includes('?') ? '&' : '?';
  const suffix = hash === undefined ? '' : `#${hash}`;
  return `${withoutHash}${separator}${BRIDGE_QUERY_PARAM}=${nonce}${suffix}`;
}

export function sanitizeStyles(styles: Record<string, string>) {
  const safe: Partial<Record<EditableCssProperty, string>> = {};
  for (const [name, value] of Object.entries(styles)) {
    if (editableProperties.has(name) && typeof value === 'string' && isSafeCssValue(value)) {
      safe[name as EditableCssProperty] = value;
    }
  }
  return safe;
}

export interface FrameMessageContext {
  frame: Window | null | undefined;
  nonce: string;
}

export function parseFrameMessage(
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>,
  { frame, nonce }: FrameMessageContext,
): FrameMessage | null {
  if (!frame || event.source !== frame || event.origin !== PREVIEW_FRAME_ORIGIN) {
    return null;
  }
  const parsed = FrameMessage.safeParse(event.data);
  if (!parsed.success || parsed.data.nonce !== nonce) {
    return null;
  }
  return parsed.data;
}

export function buildHostMessage(command: HostCommand, nonce: string): HostMessage {
  return HostMessage.parse({ ...command, nonce });
}

export function postToFrame(frame: Window | null | undefined, command: HostCommand, nonce: string) {
  if (!frame) {
    return false;
  }
  frame.postMessage(buildHostMessage(command, nonce), '*');
  return true;
}

export function subscribeToFrame(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  context: () => FrameMessageContext,
  onMessage: (message: FrameMessage) => void,
) {
  const listener = (event: MessageEvent) => {
    const message = parseFrameMessage(event, context());
    if (message) {
      onMessage(message);
    }
  };
  target.addEventListener('message', listener);
  return () => target.removeEventListener('message', listener);
}
