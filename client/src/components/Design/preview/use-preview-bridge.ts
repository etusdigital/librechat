import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { BridgePreviewMode, FrameMessage, HostCommand } from './host-protocol';
import { createBridgeNonce, postToFrame, previewFrameSrc, subscribeToFrame } from './host-protocol';

export type FrameMessageListener = (message: FrameMessage) => void;

export type FrameReady = Extract<FrameMessage, { type: 'etus:ready' }>;
export type FrameError = Extract<FrameMessage, { type: 'etus:error' }>;

export interface PreviewBridge {
  frameRef: RefObject<HTMLIFrameElement>;
  nonce: string;
  src: string | null;
  loadId: number;
  ready: FrameReady | null;
  lastError: FrameError | null;
  send: (command: HostCommand) => boolean;
  subscribe: (listener: FrameMessageListener) => () => void;
  reload: () => void;
}

export function usePreviewBridge({
  previewUrl,
  mode,
  target = typeof window === 'undefined' ? undefined : window,
}: {
  previewUrl: string | null;
  mode: BridgePreviewMode;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): PreviewBridge {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState(() => ({ id: 0, nonce: createBridgeNonce() }));
  const [ready, setReady] = useState<FrameReady | null>(null);
  const [lastError, setLastError] = useState<FrameError | null>(null);
  const listeners = useRef(new Set<FrameMessageListener>());
  const nonceRef = useRef(load.nonce);
  const modeRef = useRef(mode);
  nonceRef.current = load.nonce;
  modeRef.current = mode;

  const reload = useCallback(() => {
    setReady(null);
    setLastError(null);
    setLoad((current) => ({ id: current.id + 1, nonce: createBridgeNonce() }));
  }, []);

  const send = useCallback(
    (command: HostCommand) =>
      postToFrame(frameRef.current?.contentWindow, command, nonceRef.current),
    [],
  );

  const subscribe = useCallback((listener: FrameMessageListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!target) {
      return;
    }
    return subscribeToFrame(
      target,
      () => ({ frame: frameRef.current?.contentWindow, nonce: nonceRef.current }),
      (message) => {
        if (message.type === 'etus:ready') {
          setReady(message);
          postToFrame(
            frameRef.current?.contentWindow,
            { type: 'etus:mode', mode: modeRef.current },
            nonceRef.current,
          );
        } else if (message.type === 'etus:error') {
          setLastError(message);
        }
        listeners.current.forEach((listener) => listener(message));
      },
    );
  }, [target]);

  useEffect(() => {
    if (ready) {
      send({ type: 'etus:mode', mode });
    }
  }, [mode, ready, send]);

  useEffect(() => {
    setReady(null);
    setLastError(null);
  }, [previewUrl]);

  const src = useMemo(
    () => (previewUrl ? previewFrameSrc(previewUrl, load.nonce) : null),
    [previewUrl, load.nonce],
  );

  return {
    frameRef,
    nonce: load.nonce,
    src,
    loadId: load.id,
    ready,
    lastError,
    send,
    subscribe,
    reload,
  };
}
