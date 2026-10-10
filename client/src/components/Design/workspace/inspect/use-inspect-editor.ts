import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import type { EditableCssProperty, FrameMessage, InspectPatch } from '../../preview/host-protocol';
import type { SourcePatchError } from '../../vendor/open-design/source-patches';
import type { PreviewBridge } from '../../preview/use-preview-bridge';
import type { InspectBase, InspectSession } from './inspect-session';
import type { DesignProjectDetail } from '../../api/types';
import type { DesignTranslationKey } from '../../i18n';
import {
  EMPTY_SESSION,
  editFor,
  editsToPatches,
  inspectSessionAtomFamily,
  inspectSessionKey,
  isBaseStale,
  liveCommandsFor,
  newEdit,
  reconcileFramePatches,
  setEditStyle,
  setEditText,
  shaOfEtag,
} from './inspect-session';
import {
  applySourcePatches,
  normalizeSnippet,
  readSourceElement,
} from '../../vendor/open-design/source-patches';
import { designErrorMessageKey, isDesignApiError } from '../../api/errors';
import { sanitizeStyles } from '../../preview/host-protocol';
import { workspaceKeys } from '../../api/workspace';
import { readBlobText } from '../use-file-content';
import { designKeys } from '../../api/queries';
import { designApi } from '../../api/client';

export const FRAME_PATCHES_TIMEOUT_MS = 1500;
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

type FrameBridge = Pick<PreviewBridge, 'ready' | 'send' | 'subscribe'>;
type TargetMessage = Extract<FrameMessage, { type: 'etus:target' }>;

export function requestFramePatches(
  bridge: FrameBridge,
  timeoutMs = FRAME_PATCHES_TIMEOUT_MS,
): Promise<InspectPatch[] | null> {
  if (!bridge.ready) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (patches: InspectPatch[] | null) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(patches);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    unsubscribe = bridge.subscribe((message) => {
      if (message.type === 'etus:inspect-patches') {
        finish(message.patches);
      }
    });
    try {
      if (!bridge.send({ type: 'etus:inspect-extract' })) {
        finish(null);
      }
    } catch {
      finish(null);
    }
  });
}

export function cssSupports(property: string, value: string) {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
    return true;
  }
  return CSS.supports(property, value);
}

export function isAcceptedStyle(property: EditableCssProperty, value: string) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return true;
  }
  return (
    sanitizeStyles({ [property]: trimmed })[property] === trimmed && cssSupports(property, trimmed)
  );
}

export function patchErrorKey(error: SourcePatchError): DesignTranslationKey {
  if (error === 'target_changed' || error === 'target_not_found' || error === 'target_ambiguous') {
    return 'inspect.error_target_changed';
  }
  return 'inspect.error_patch';
}

function editableContext(session: InspectSession) {
  if (!session.target || session.source?.state !== 'ready') {
    return null;
  }
  const { selector } = session.target;
  const { element } = session.source;
  return { selector, element, create: () => newEdit(selector, element) };
}

function safeSend(bridge: FrameBridge, command: Parameters<PreviewBridge['send']>[0]) {
  try {
    return bridge.send(command);
  } catch {
    return false;
  }
}

export interface InspectEditor {
  session: InspectSession;
  conflict: boolean;
  saving: boolean;
  errorKey: DesignTranslationKey | null;
  savedVersion: number | null;
  setText: (text: string) => void;
  setStyle: (property: EditableCssProperty, value: string) => boolean;
  save: () => Promise<void>;
  applyOverLatest: () => Promise<void>;
  discard: () => void;
  reloadLatest: () => void;
}

export function useInspectEditor({
  project,
  path,
  bridge,
}: {
  project: DesignProjectDetail;
  path: string;
  bridge: PreviewBridge;
}): InspectEditor {
  const projectId = project.projectId;
  const queryClient = useQueryClient();
  const [session, setSession] = useAtom(
    inspectSessionAtomFamily(inspectSessionKey(projectId, path)),
  );
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<DesignTranslationKey | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const sessionRef = useRef(session);
  const bridgeRef = useRef(bridge);
  const requestRef = useRef(0);
  sessionRef.current = session;
  bridgeRef.current = bridge;

  const update = useCallback(
    (change: (current: InspectSession) => InspectSession) => {
      setSession((current) => {
        const next = change(current);
        sessionRef.current = next;
        return next;
      });
    },
    [setSession],
  );

  const fetchLatest = useCallback(async (): Promise<InspectBase> => {
    const content = await queryClient.fetchQuery({
      queryKey: designKeys.fileContent(projectId, path),
      queryFn: ({ signal }) => designApi.readFile(projectId, { path }, signal),
      staleTime: 0,
    });
    const sha256 = shaOfEtag(content.etag);
    if (!sha256 || !content.etag) {
      throw new Error('missing_etag');
    }
    return {
      source: await readBlobText(content.blob),
      etag: content.etag,
      sha256,
      version: content.version,
    };
  }, [projectId, path, queryClient]);

  const onTarget = useCallback(
    async (message: TargetMessage) => {
      const request = ++requestRef.current;
      update((current) => ({
        ...current,
        target: {
          selector: message.selector,
          tag: message.tag,
          textSnippet: message.textSnippet,
          computed: message.computed,
        },
        source: { state: 'loading' },
      }));
      try {
        const current = sessionRef.current;
        const base = current.base && current.edits.length ? current.base : await fetchLatest();
        if (request !== requestRef.current) {
          return;
        }
        const found = readSourceElement(base.source, message.selector);
        if (!found.ok) {
          update((now) => ({
            ...now,
            base: now.edits.length ? now.base : base,
            source: { state: 'unavailable', reason: 'not_in_source' },
          }));
          return;
        }
        const edit = editFor(sessionRef.current.edits, message.selector);
        const expected =
          edit?.text === undefined ? found.element.snippet : normalizeSnippet(edit.text);
        const live = normalizeSnippet(message.textSnippet);
        update((now) => ({
          ...now,
          base: now.edits.length ? now.base : base,
          source:
            live === expected
              ? { state: 'ready', element: found.element }
              : { state: 'unavailable', reason: 'dynamic' },
        }));
      } catch {
        if (request === requestRef.current) {
          update((now) => ({ ...now, source: { state: 'unavailable', reason: 'load_failed' } }));
        }
      }
    },
    [fetchLatest, update],
  );

  const { subscribe, ready } = bridge;

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === 'etus:target') {
          onTarget(message);
        }
      }),
    [subscribe, onTarget],
  );

  useEffect(() => {
    if (!ready) {
      return;
    }
    const current = sessionRef.current;
    liveCommandsFor(current.edits).forEach((command) => safeSend(bridgeRef.current, command));
    if (current.target) {
      safeSend(bridgeRef.current, { type: 'etus:highlight', selector: current.target.selector });
    }
  }, [ready]);

  const ensureBase = useCallback(() => {
    if (sessionRef.current.base) {
      return;
    }
    fetchLatest().then(
      (base) => update((current) => (current.base ? current : { ...current, base })),
      () => undefined,
    );
  }, [fetchLatest, update]);

  const setText = useCallback(
    (text: string) => {
      const context = editableContext(sessionRef.current);
      if (!context || !context.element.textEditable) {
        return;
      }
      const { selector, create } = context;
      setSavedVersion(null);
      ensureBase();
      update((current) => ({
        ...current,
        edits: setEditText(current.edits, selector, create, text),
      }));
      safeSend(bridgeRef.current, { type: 'etus:inspect-set', selector, text });
    },
    [ensureBase, update],
  );

  const setStyle = useCallback(
    (property: EditableCssProperty, value: string) => {
      const context = editableContext(sessionRef.current);
      if (!context) {
        return false;
      }
      if (!isAcceptedStyle(property, value)) {
        return false;
      }
      const { selector, create } = context;
      const trimmed = value.trim();
      setSavedVersion(null);
      ensureBase();
      update((current) => ({
        ...current,
        edits: setEditStyle(current.edits, selector, create, property, trimmed),
      }));
      safeSend(bridgeRef.current, {
        type: 'etus:inspect-set',
        selector,
        styles: sanitizeStyles({ [property]: trimmed }),
      });
      return true;
    },
    [ensureBase, update],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: designKeys.project(projectId), exact: true });
    queryClient.invalidateQueries({ queryKey: designKeys.files(projectId) });
    queryClient.invalidateQueries({ queryKey: workspaceKeys.fileContentPrefix(projectId, path) });
    queryClient.invalidateQueries({ queryKey: designKeys.versions(projectId, path) });
  }, [projectId, path, queryClient]);

  const finishWith = useCallback(
    (version: number | null) => {
      requestRef.current += 1;
      update(() => EMPTY_SESSION);
      setSavedVersion(version);
      invalidate();
      bridgeRef.current.reload();
    },
    [invalidate, update],
  );

  const commit = useCallback(
    async (over: 'base' | 'latest') => {
      if (saving || sessionRef.current.edits.length === 0) {
        return;
      }
      setSaving(true);
      setErrorKey(null);
      try {
        const framePatches = await requestFramePatches(bridgeRef.current);
        const { edits } = reconcileFramePatches(sessionRef.current.edits, framePatches);
        if (edits.length === 0) {
          setErrorKey('inspect.error_not_applied');
          return;
        }
        const base =
          over === 'latest' || !sessionRef.current.base
            ? await fetchLatest()
            : sessionRef.current.base;
        const result = applySourcePatches(base.source, editsToPatches(edits));
        if (!result.ok) {
          setErrorKey(patchErrorKey(result.error));
          return;
        }
        const written = await designApi.writeFile(projectId, {
          path,
          content: result.source,
          contentType: HTML_CONTENT_TYPE,
          ifMatch: base.etag,
          versionSource: 'inline_edit',
        });
        finishWith(written.version ?? null);
      } catch (error) {
        if (isDesignApiError(error) && error.status === 412) {
          update((current) => ({ ...current, conflict: true }));
          return;
        }
        const key = designErrorMessageKey(error);
        setErrorKey(key === 'error_generic' ? 'inspect.error_save' : key);
      } finally {
        setSaving(false);
      }
    },
    [fetchLatest, finishWith, path, projectId, saving, update],
  );

  const discard = useCallback(() => {
    requestRef.current += 1;
    safeSend(bridgeRef.current, { type: 'etus:inspect-reset' });
    setErrorKey(null);
    update((current) => ({ ...EMPTY_SESSION, target: current.target, source: current.source }));
  }, [update]);

  const reloadLatest = useCallback(() => {
    requestRef.current += 1;
    safeSend(bridgeRef.current, { type: 'etus:inspect-reset' });
    setErrorKey(null);
    update(() => EMPTY_SESSION);
    invalidate();
    bridgeRef.current.reload();
  }, [invalidate, update]);

  const currentSha = project.files.find((file) => file.path === path)?.sha256;
  const conflict =
    session.edits.length > 0 && (session.conflict || isBaseStale(session.base, currentSha));

  return {
    session,
    conflict,
    saving,
    errorKey,
    savedVersion,
    setText,
    setStyle,
    save: () => commit('base'),
    applyOverLatest: () => commit('latest'),
    discard,
    reloadLatest,
  };
}
