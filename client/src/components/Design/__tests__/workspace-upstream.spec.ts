import fs from 'fs';
import path from 'path';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import useSidebarState from '~/hooks/Nav/useSidebarState';
import store from '~/store';

const SRC = path.resolve(__dirname, '../../..');

describe('LibreChat internals used by the Design workspace header', () => {
  it('still exports the sidebar state and toggle hooks', () => {
    expect(typeof useSidebarState).toBe('function');
    expect(typeof useSidebarToggle).toBe('function');
    expect(store.sidebarExpanded).toBeDefined();
  });

  it('still names the chat menu chat-history-nav', () => {
    const opener = fs.readFileSync(path.join(SRC, 'components/Chat/Menus/OpenSidebar.tsx'), 'utf8');
    expect(opener).toContain('aria-controls="chat-history-nav"');
  });
});
