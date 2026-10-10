import { act, renderHook } from '@testing-library/react';
import type { FrameMessage } from '../preview/host-protocol';
import { usePreviewBridge } from '../preview/use-preview-bridge';

const PREVIEW_URL = 'https://chat.test/preview/p/tok/index.html';

function setup(initialMode: 'view' | 'comment' | 'inspect' = 'view') {
  const target = new EventTarget() as unknown as Window;
  const frameWindow = { postMessage: jest.fn() } as unknown as Window;
  const otherWindow = { postMessage: jest.fn() } as unknown as Window;
  const hook = renderHook(({ mode, url }) => usePreviewBridge({ previewUrl: url, mode, target }), {
    initialProps: { mode: initialMode as 'view' | 'comment' | 'inspect', url: PREVIEW_URL },
  });
  const frame = document.createElement('iframe');
  Object.defineProperty(frame, 'contentWindow', { get: () => frameWindow });
  (hook.result.current.frameRef as { current: HTMLIFrameElement | null }).current = frame;

  const dispatch = (data: unknown, init: { origin?: string; source?: Window } = {}) => {
    const event = new MessageEvent('message', { data, origin: init.origin ?? 'null' });
    Object.defineProperty(event, 'source', { value: init.source ?? frameWindow });
    act(() => {
      target.dispatchEvent(event);
    });
  };
  return { hook, frameWindow, otherWindow, dispatch };
}

const ready = (nonce: string): FrameMessage => ({
  type: 'etus:ready',
  nonce,
  title: 'Landing',
  docHeight: 1200,
});

describe('usePreviewBridge', () => {
  it('builds the iframe src with the bridge nonce', () => {
    const { hook } = setup();
    const { src, nonce } = hook.result.current;
    expect(src).toBe(`${PREVIEW_URL}?bridge=${nonce}`);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it('accepts ready from the frame and sends the current mode back', () => {
    const { hook, frameWindow, dispatch } = setup('comment');
    const { nonce } = hook.result.current;
    dispatch(ready(nonce));
    expect(hook.result.current.ready).toMatchObject({ title: 'Landing', docHeight: 1200 });
    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      { type: 'etus:mode', mode: 'comment', nonce },
      '*',
    );
  });

  it('ignores messages with a wrong nonce, from another window, origin or shape', () => {
    const { hook, otherWindow, dispatch } = setup();
    const { nonce } = hook.result.current;
    const listener = jest.fn();
    act(() => {
      hook.result.current.subscribe(listener);
    });
    dispatch(ready('another-nonce-that-is-valid-0001'));
    dispatch(ready(nonce), { source: otherWindow });
    dispatch(ready(nonce), { origin: 'https://chat.test' });
    dispatch({ type: 'etus:ready', nonce, title: 'x' });
    dispatch({ ...ready(nonce), extra: true });
    expect(hook.result.current.ready).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    dispatch(ready(nonce));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forwards valid messages to subscribers and keeps the last error', () => {
    const { hook, dispatch } = setup();
    const { nonce } = hook.result.current;
    const listener = jest.fn();
    let unsubscribe = () => undefined as void;
    act(() => {
      unsubscribe = hook.result.current.subscribe(listener);
    });
    const error = { type: 'etus:error', nonce, message: 'boom', source: 'inline', line: 3 };
    dispatch(error);
    expect(listener).toHaveBeenCalledWith(error);
    expect(hook.result.current.lastError).toEqual(error);
    unsubscribe();
    dispatch(error);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends mode changes once the frame is ready', () => {
    const { hook, frameWindow, dispatch } = setup('view');
    const { nonce } = hook.result.current;
    hook.rerender({ mode: 'inspect', url: PREVIEW_URL });
    expect(frameWindow.postMessage).not.toHaveBeenCalled();
    dispatch(ready(nonce));
    hook.rerender({ mode: 'comment', url: PREVIEW_URL });
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith(
      { type: 'etus:mode', mode: 'comment', nonce },
      '*',
    );
  });

  it('validates commands before posting them', () => {
    const { hook, frameWindow } = setup();
    expect(hook.result.current.send({ type: 'etus:highlight', selector: 'h1' })).toBe(true);
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(() =>
      hook.result.current.send({
        type: 'etus:inspect-set',
        selector: 'h1',
        styles: { color: 'url(javascript:alert(1))' },
      }),
    ).toThrow();
  });

  it('rotates the nonce on reload and drops messages signed with the old one', () => {
    const { hook, dispatch } = setup();
    const first = hook.result.current.nonce;
    act(() => hook.result.current.reload());
    const second = hook.result.current.nonce;
    expect(second).not.toBe(first);
    expect(hook.result.current.src).toContain(`bridge=${second}`);
    expect(hook.result.current.loadId).toBe(1);
    dispatch(ready(first));
    expect(hook.result.current.ready).toBeNull();
    dispatch(ready(second));
    expect(hook.result.current.ready).not.toBeNull();
  });

  it('has no src without a preview url', () => {
    const target = new EventTarget() as unknown as Window;
    const { result } = renderHook(() =>
      usePreviewBridge({ previewUrl: null, mode: 'view', target }),
    );
    expect(result.current.src).toBeNull();
  });
});
