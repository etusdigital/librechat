import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceTabsProvider, useFocusWorkspaceTab } from '../workspace/workspace-tabs';

describe('useFocusWorkspaceTab', () => {
  it('calls the focus of the workspace', () => {
    const onFocus = jest.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceTabsProvider onFocus={onFocus}>{children}</WorkspaceTabsProvider>
    );
    const { result } = renderHook(() => useFocusWorkspaceTab(), { wrapper });
    result.current.focus('chat');
    result.current.focus('files');
    expect(onFocus.mock.calls).toEqual([['chat'], ['files']]);
  });

  it('does nothing outside a workspace', () => {
    const { result } = renderHook(() => useFocusWorkspaceTab());
    expect(() => result.current.focus('preview')).not.toThrow();
  });
});
