import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FileEntry, ProjectChanges } from '../api/types';
import {
  CHANGES_POLL_IDLE_MS,
  CHANGES_POLL_RESPONDING_MS,
  applyChanges,
  diffChanges,
  useProjectChanges,
} from '../workspace/use-project-changes';
import { workspaceApi } from '../api/workspace';

jest.mock('../api/workspace', () => ({
  ...jest.requireActual('../api/workspace'),
  workspaceApi: { listChanges: jest.fn() },
}));

const listChanges = workspaceApi.listChanges as jest.Mock;

const file = (path: string, sha256: string): FileEntry => ({
  path,
  sha256,
  mime: 'text/html',
  size: 1,
  version: 1,
  updatedAt: null,
  updatedBy: 's',
});

const changes = (items: FileEntry[], paths: string[], until = 't'): ProjectChanges => ({
  items,
  paths,
  projectUpdatedAt: 'p',
  until,
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setup(responding = false) {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const onChange = jest.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ busy }) => useProjectChanges({ projectId: 'prj_1', responding: busy, onChange }),
    { wrapper, initialProps: { busy: responding } },
  );
  return { hook, invalidate, onChange };
}

describe('change detection', () => {
  it('reports changed and removed files against what is known', () => {
    const known = new Map([
      ['index.html', 'a'],
      ['old.css', 'b'],
    ]);
    const next = changes([file('index.html', 'a2'), file('new.js', 'c')], ['index.html', 'new.js']);
    expect(diffChanges(known, next)).toEqual({
      changed: ['index.html', 'new.js'],
      removed: ['old.css'],
    });
    expect([...applyChanges(known, next)]).toEqual([
      ['index.html', 'a2'],
      ['new.js', 'c'],
    ]);
  });

  it('ignores the same version received twice', () => {
    const known = new Map([['index.html', 'a']]);
    expect(diffChanges(known, changes([file('index.html', 'a')], ['index.html']))).toEqual({
      changed: [],
      removed: [],
    });
  });
});

describe('useProjectChanges', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    listChanges.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls every 20 s when idle and every 3 s while the agent responds', async () => {
    listChanges.mockResolvedValue(changes([], [], 'u1'));
    const { hook } = setup(false);
    await flush();
    expect(listChanges).toHaveBeenCalledTimes(1);
    expect(listChanges).toHaveBeenLastCalledWith('prj_1', undefined, expect.any(AbortSignal));

    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_IDLE_MS - 1);
    });
    expect(listChanges).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    expect(listChanges).toHaveBeenCalledTimes(2);
    expect(listChanges).toHaveBeenLastCalledWith('prj_1', 'u1', expect.any(AbortSignal));

    hook.rerender({ busy: true });
    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_RESPONDING_MS);
    });
    await flush();
    expect(listChanges).toHaveBeenCalledTimes(3);
    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_RESPONDING_MS);
    });
    await flush();
    expect(listChanges).toHaveBeenCalledTimes(4);

    hook.rerender({ busy: false });
    await act(async () => {
      jest.advanceTimersByTime(0);
    });
    await flush();
    expect(listChanges).toHaveBeenCalledTimes(5);
    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_RESPONDING_MS);
    });
    expect(listChanges).toHaveBeenCalledTimes(5);
  });

  it('treats the first answer as the baseline and bumps the revision on real changes', async () => {
    listChanges
      .mockResolvedValueOnce(changes([file('index.html', 'a')], ['index.html'], 'u1'))
      .mockResolvedValueOnce(changes([file('index.html', 'a')], ['index.html'], 'u2'))
      .mockResolvedValueOnce(changes([file('index.html', 'b')], ['index.html'], 'u3'))
      .mockResolvedValue(changes([], [], 'u4'));
    const { hook, invalidate, onChange } = setup(true);
    await flush();
    expect(hook.result.current.revision).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_RESPONDING_MS);
    });
    await flush();
    expect(hook.result.current.revision).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_RESPONDING_MS);
    });
    await flush();
    expect(hook.result.current.revision).toBe(1);
    expect(hook.result.current.lastChange).toEqual({ changed: ['index.html'], removed: [] });
    expect(onChange).toHaveBeenCalledWith({ changed: ['index.html'], removed: [] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['etus-design', 'project', 'prj_1', 'content', 'index.html'],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['etus-design', 'project', 'prj_1', 'files'],
    });

    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_RESPONDING_MS);
    });
    await flush();
    expect(hook.result.current.revision).toBe(2);
    expect(hook.result.current.lastChange).toEqual({ changed: [], removed: ['index.html'] });
  });

  it('keeps polling after a failure and stops when unmounted', async () => {
    listChanges.mockRejectedValueOnce(new Error('down')).mockResolvedValue(changes([], [], 'u'));
    const { hook } = setup(false);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_IDLE_MS);
    });
    await flush();
    expect(listChanges).toHaveBeenCalledTimes(2);
    hook.unmount();
    await act(async () => {
      jest.advanceTimersByTime(CHANGES_POLL_IDLE_MS * 3);
    });
    expect(listChanges).toHaveBeenCalledTimes(2);
  });
});
