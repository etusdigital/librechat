import { useCallback, useEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import type { WorkspacePanel } from '../../state/atoms';
import { previewHighlightAtom, workspaceModeAtom, workspacePanelAtom } from '../../state/atoms';
import { useFocusWorkspaceTab } from '../workspace-tabs';
import { modeExtension } from '../modes';

export const SIDE_PANEL_IDS: Record<WorkspacePanel, string> = {
  plan: 'design-plan-panel',
  jury: 'design-jury-panel',
};

export function useWorkspacePanel() {
  const [panel, setPanel] = useAtom(workspacePanelAtom);
  const [mode, setMode] = useAtom(workspaceModeAtom);
  const setHighlight = useSetAtom(previewHighlightAtom);
  const { focus } = useFocusWorkspaceTab();

  const open = useCallback(
    (next: WorkspacePanel) => {
      if (modeExtension(mode).Panel) {
        setMode('view');
      }
      setPanel(next);
      focus('preview');
    },
    [focus, mode, setMode, setPanel],
  );

  const close = useCallback(() => {
    setPanel(null);
    setHighlight(null);
  }, [setHighlight, setPanel]);

  const toggle = useCallback(
    (next: WorkspacePanel) => (panel === next ? close() : open(next)),
    [close, open, panel],
  );

  return { panel, open, close, toggle };
}

export function useExclusiveWorkspacePanels() {
  const [panel, setPanel] = useAtom(workspacePanelAtom);
  const [mode] = useAtom(workspaceModeAtom);
  const setHighlight = useSetAtom(previewHighlightAtom);
  const previousMode = useRef(mode);

  useEffect(() => {
    if (mode === previousMode.current) {
      return;
    }
    previousMode.current = mode;
    if (modeExtension(mode).Panel) {
      setPanel(null);
    }
  }, [mode, setPanel]);

  useEffect(() => {
    if (panel !== 'jury') {
      setHighlight(null);
    }
  }, [panel, setHighlight]);

  useEffect(
    () => () => {
      setPanel(null);
      setHighlight(null);
    },
    [setHighlight, setPanel],
  );
}
