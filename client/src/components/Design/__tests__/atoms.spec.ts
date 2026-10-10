import { createStore } from 'jotai';
import {
  DEVICES,
  EMPTY_TABS,
  ZOOM_LEVELS,
  closeTab,
  keepExistingTabs,
  openTab,
  workspaceModeAtom,
  workspaceTabsAtomFamily,
} from '../state/atoms';

describe('workspace state', () => {
  it('opens a tab once and activates it', () => {
    const one = openTab(EMPTY_TABS, 'index.html');
    const two = openTab(one, 'styles.css');
    expect(two).toEqual({ open: ['index.html', 'styles.css'], active: 'styles.css' });
    expect(openTab(two, 'index.html')).toEqual({
      open: ['index.html', 'styles.css'],
      active: 'index.html',
    });
  });

  it('closes a tab and activates its neighbour', () => {
    const tabs = { open: ['a', 'b', 'c'], active: 'b' };
    expect(closeTab(tabs, 'b')).toEqual({ open: ['a', 'c'], active: 'c' });
    expect(closeTab({ open: ['a', 'b'], active: 'b' }, 'b')).toEqual({ open: ['a'], active: 'a' });
    expect(closeTab({ open: ['a'], active: 'a' }, 'a')).toEqual(EMPTY_TABS);
    expect(closeTab(tabs, 'a')).toEqual({ open: ['b', 'c'], active: 'b' });
    expect(closeTab(tabs, 'missing')).toBe(tabs);
  });

  it('drops tabs of files that no longer exist', () => {
    expect(keepExistingTabs({ open: ['a', 'b', 'c'], active: 'b' }, ['a', 'c'])).toEqual({
      open: ['a', 'c'],
      active: 'c',
    });
  });

  it('keeps tabs per project and the spec devices and zoom levels', () => {
    const store = createStore();
    store.set(workspaceTabsAtomFamily('prj_1'), openTab(EMPTY_TABS, 'index.html'));
    expect(store.get(workspaceTabsAtomFamily('prj_2'))).toEqual(EMPTY_TABS);
    expect(store.get(workspaceTabsAtomFamily('prj_1')).active).toBe('index.html');
    expect(store.get(workspaceModeAtom)).toBe('view');
    expect(DEVICES.mobile).toEqual({ width: 390, height: 844 });
    expect(DEVICES.tablet).toEqual({ width: 820, height: 1180 });
    expect(DEVICES.desktop).toEqual({ width: 1440, height: 900 });
    expect(ZOOM_LEVELS).toEqual([0.5, 0.75, 1, 1.25, 1.5, 'fit']);
  });
});
