import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

export type WorkspaceTab = 'chat' | 'preview' | 'files';

export interface WorkspaceTabFocus {
  focus: (tab: WorkspaceTab) => void;
}

const ignoreFocus: WorkspaceTabFocus = { focus: () => undefined };

const WorkspaceTabsContext = createContext<WorkspaceTabFocus>(ignoreFocus);

export function WorkspaceTabsProvider({
  onFocus,
  children,
}: {
  onFocus: (tab: WorkspaceTab) => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ focus: onFocus }), [onFocus]);
  return <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>;
}

export function useFocusWorkspaceTab(): WorkspaceTabFocus {
  return useContext(WorkspaceTabsContext);
}
