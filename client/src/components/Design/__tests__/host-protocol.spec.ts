import {
  FrameMessage,
  HostMessage,
  PREVIEW_FRAME_ORIGIN,
  PREVIEW_REFERRER_POLICY,
  PREVIEW_SANDBOX,
  buildHostMessage,
  createBridgeNonce,
  isBridgeNonce,
  parseFrameMessage,
  postToFrame,
  previewFrameSrc,
  sanitizeStyles,
  subscribeToFrame,
} from '../preview/host-protocol';

const NONCE = 'n0nce_for-the-bridge-0001';
const OTHER_NONCE = 'n0nce_for-the-bridge-0002';
const rect = { x: 1, y: 2, w: 3, h: 4 };

const frameMessages = [
  { type: 'etus:ready', nonce: NONCE, title: 'Landing', docHeight: 2400 },
  { type: 'etus:hover', nonce: NONCE, selector: 'section.hero > h1', rect, tag: 'h1' },
  {
    type: 'etus:target',
    nonce: NONCE,
    selector: 'section.hero > h1',
    textSnippet: 'Título atual',
    rect,
    tag: 'h1',
    computed: {
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      fontSize: '48px',
      fontWeight: '700',
      textAlign: 'left',
      margin: '0px',
      padding: '0px',
      borderRadius: '0px',
    },
  },
  {
    type: 'etus:inspect-patches',
    nonce: NONCE,
    patches: [{ selector: 'h1', text: 'Novo', styles: { color: '#111', 'font-size': '40px' } }],
  },
  { type: 'etus:error', nonce: NONCE, message: 'boom', source: 'index.html', line: 3 },
];

function fakeFrame() {
  return { postMessage: jest.fn() } as unknown as Window & { postMessage: jest.Mock };
}

describe('preview host protocol (C 3.5)', () => {
  it('uses the sandbox and referrer policy of the spec, never allow-same-origin', () => {
    expect(PREVIEW_SANDBOX).toBe('allow-scripts allow-forms allow-popups');
    expect(PREVIEW_SANDBOX).not.toContain('allow-same-origin');
    expect(PREVIEW_SANDBOX).not.toContain('allow-top-navigation');
    expect(PREVIEW_REFERRER_POLICY).toBe('no-referrer');
    expect(PREVIEW_FRAME_ORIGIN).toBe('null');
  });

  it('accepts every message the bridge sends', () => {
    for (const message of frameMessages) {
      expect(FrameMessage.safeParse(message).success).toBe(true);
    }
  });

  it('accepts every message the screen sends', () => {
    const messages = [
      { type: 'etus:mode', nonce: NONCE, mode: 'comment' },
      { type: 'etus:highlight', nonce: NONCE, selector: 'footer a:nth-of-type(2)' },
      {
        type: 'etus:inspect-set',
        nonce: NONCE,
        selector: 'h1',
        text: 'Oi',
        styles: { gap: '8px' },
      },
      { type: 'etus:inspect-extract', nonce: NONCE },
      { type: 'etus:inspect-reset', nonce: NONCE },
    ];
    for (const message of messages) {
      expect(HostMessage.safeParse(message).success).toBe(true);
    }
  });

  describe('C-3: frame messages are validated before use', () => {
    const frame = fakeFrame();
    const ready = frameMessages[0];
    const event = (overrides: Partial<MessageEvent>) =>
      ({ data: ready, origin: 'null', source: frame, ...overrides }) as MessageEvent;

    it('accepts a valid message from the preview frame', () => {
      expect(parseFrameMessage(event({}), { frame, nonce: NONCE })).toEqual(ready);
    });

    it('ignores a message with the wrong nonce', () => {
      expect(parseFrameMessage(event({}), { frame, nonce: OTHER_NONCE })).toBeNull();
    });

    it('ignores a message from another window', () => {
      const other = fakeFrame();
      expect(
        parseFrameMessage(event({ source: other as unknown as MessageEventSource }), {
          frame,
          nonce: NONCE,
        }),
      ).toBeNull();
      expect(parseFrameMessage(event({ source: null }), { frame, nonce: NONCE })).toBeNull();
    });

    it('ignores a message whose origin is not the opaque "null"', () => {
      for (const origin of ['http://localhost:3080', 'https://chat-ai.etus.io', '', 'NULL']) {
        expect(parseFrameMessage(event({ origin }), { frame, nonce: NONCE })).toBeNull();
      }
    });

    it('ignores a message with an invalid shape', () => {
      const invalid = [
        null,
        'etus:ready',
        { ...ready, type: 'od:ready' },
        { ...ready, extra: true },
        { ...ready, docHeight: -1 },
        { ...ready, nonce: 'short' },
        { ...frameMessages[1], tag: 'H1<script>' },
        { ...frameMessages[2], textSnippet: 'x'.repeat(201) },
        {
          ...frameMessages[3],
          patches: [{ selector: 'h1', styles: { color: 'url(https://evil.example)' } }],
        },
        { ...frameMessages[3], patches: [{ selector: 'h1', styles: { position: 'fixed' } }] },
      ];
      for (const data of invalid) {
        expect(parseFrameMessage(event({ data }), { frame, nonce: NONCE })).toBeNull();
      }
    });

    it('ignores everything when there is no frame yet', () => {
      expect(parseFrameMessage(event({}), { frame: null, nonce: NONCE })).toBeNull();
    });
  });

  it('subscribes to window messages and stops on cleanup', () => {
    const frame = fakeFrame();
    const target = new EventTarget() as unknown as Window;
    const onMessage = jest.fn();
    const stop = subscribeToFrame(target, () => ({ frame, nonce: NONCE }), onMessage);
    const dispatch = (data: unknown, origin = 'null') => {
      const message = new MessageEvent('message', { data, origin });
      Object.defineProperty(message, 'source', { value: frame });
      target.dispatchEvent(message);
    };
    dispatch(frameMessages[0]);
    dispatch(frameMessages[0], 'https://evil.example');
    dispatch({ ...frameMessages[0], nonce: OTHER_NONCE });
    expect(onMessage).toHaveBeenCalledTimes(1);
    stop();
    dispatch(frameMessages[0]);
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('posts validated commands with the nonce and a wildcard target origin', () => {
    const frame = fakeFrame();
    expect(postToFrame(frame, { type: 'etus:mode', mode: 'inspect' }, NONCE)).toBe(true);
    expect(frame.postMessage).toHaveBeenCalledWith(
      { type: 'etus:mode', mode: 'inspect', nonce: NONCE },
      '*',
    );
    expect(postToFrame(null, { type: 'etus:inspect-reset' }, NONCE)).toBe(false);
  });

  it('refuses to build commands with unsafe styles or a bad nonce', () => {
    expect(() =>
      buildHostMessage(
        { type: 'etus:inspect-set', selector: 'h1', styles: { color: 'red; background: x' } },
        NONCE,
      ),
    ).toThrow();
    expect(() => buildHostMessage({ type: 'etus:inspect-extract' }, 'bad')).toThrow();
  });

  it('keeps only editable properties with safe values', () => {
    expect(
      sanitizeStyles({
        color: '#fff',
        'background-color': 'url(x)',
        'font-size': 'expression(alert(1))',
        position: 'fixed',
        'margin-top': '4px',
        opacity: 'javascript:alert(1)',
        gap: '@import x',
        padding: '1px}',
      }),
    ).toEqual({ color: '#fff', 'margin-top': '4px' });
  });

  it('creates unpredictable nonces in the format the bridge accepts', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createBridgeNonce()));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(isBridgeNonce(nonce)).toBe(true);
    }
  });

  it('adds the bridge nonce to the preview URL', () => {
    expect(previewFrameSrc('/preview/p/tok/index.html', NONCE)).toBe(
      `/preview/p/tok/index.html?bridge=${NONCE}`,
    );
    expect(previewFrameSrc('/preview/p/tok/index.html?v=2#top', NONCE)).toBe(
      `/preview/p/tok/index.html?v=2&bridge=${NONCE}#top`,
    );
    expect(() => previewFrameSrc('/preview/p/tok/', 'bad nonce')).toThrow();
  });
});
