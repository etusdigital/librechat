import fs from 'fs';
import path from 'path';
import * as reactRouter from 'react-router-dom';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import {
  DESIGN_AGENT_ID,
  HIDDEN_CHAT_CONTROL_TEST_IDS,
  conversationIdFromPath,
  initialChatEntry,
} from '../chat/DesignChatAdapter';
import { processValidSettings } from '~/utils/createChatSearchParams';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useFileHandlingNoChatContext } from '~/hooks/Files';
import { mainTextareaId } from '~/common/types';
import ChatRoute from '~/routes/ChatRoute';
import store from '~/store';

const SRC = path.resolve(__dirname, '../../..');
const source = (file: string) => fs.readFileSync(path.join(SRC, file), 'utf8');

describe('LibreChat internals used by the Design chat adapter', () => {
  it('still exports the chat route, hooks and composer id', () => {
    expect(typeof ChatRoute).toBe('function');
    expect(typeof useLatestMessage).toBe('function');
    expect(typeof useFileHandlingNoChatContext).toBe('function');
    expect(mainTextareaId).toBe('prompt-textarea');
  });

  it('still has the nested data router pieces', () => {
    expect(typeof reactRouter.createMemoryRouter).toBe('function');
    expect(reactRouter.RouterProvider).toBeDefined();
    expect(reactRouter.UNSAFE_LocationContext).toBeDefined();
    expect(reactRouter.UNSAFE_RouteContext).toBeDefined();
  });

  it('still keeps composer, files, conversation and submitting state by index', () => {
    for (const family of [
      store.activePromptByIndex,
      store.filesByIndex,
      store.conversationByIndex,
      store.conversationIdByIndex,
      store.isSubmittingFamily,
    ]) {
      expect(typeof family).toBe('function');
      expect(family(0)).toBeDefined();
    }
  });

  it('still drains the active prompt into the composer at the cursor', () => {
    const textarea = source('hooks/Input/useTextarea.ts');
    expect(textarea).toContain('store.activePromptByIndex(');
    expect(textarea).toContain('value.slice(0, selectionStart)');
  });

  it('still reads the agent and the auto submitted prompt from the url', () => {
    expect(processValidSettings({ agent_id: DESIGN_AGENT_ID })).toEqual(
      expect.objectContaining({ endpoint: EModelEndpoint.agents, agent_id: DESIGN_AGENT_ID }),
    );
    const queryParams = source('hooks/Input/useQueryParams.ts');
    expect(queryParams).toContain('queryParams.prompt');
    expect(queryParams).toContain("queryParams.submit?.toLowerCase() === 'true'");
  });

  it('still moves a new conversation from /c/new to /c/<id>', () => {
    const handlers = source('hooks/SSE/useEventHandlers.ts');
    expect(handlers).toContain('location.pathname === `/c/${Constants.NEW_CONVO}`');
    expect(handlers).toContain('navigate(`/c/${conversation.conversationId}`');
    expect(conversationIdFromPath(`/c/${Constants.NEW_CONVO}`)).toBe(Constants.NEW_CONVO);
    expect(conversationIdFromPath('/c/abc-123')).toBe('abc-123');
    expect(conversationIdFromPath('/agents')).toBeNull();
  });

  it('still marks the header controls hidden in the embedded chat', () => {
    expect(HIDDEN_CHAT_CONTROL_TEST_IDS).toEqual([
      'header-new-chat-button',
      'model-selector-button',
    ]);
    expect(source('components/Chat/Menus/NewChat.tsx')).toContain(
      'data-testid="header-new-chat-button"',
    );
    expect(source('components/Chat/Menus/Endpoints/ModelSelector.tsx')).toContain(
      'data-testid="model-selector-button"',
    );
  });

  it('opens a new conversation with the agent and the first message, or an existing one', () => {
    const entry = initialChatEntry(DESIGN_AGENT_ID, null, '[Projeto Etus Design]: prj_1\n\noi');
    const url = new URL(entry, 'http://chat.test');
    expect(url.pathname).toBe(`/c/${Constants.NEW_CONVO}`);
    expect(url.searchParams.get('agent_id')).toBe(DESIGN_AGENT_ID);
    expect(url.searchParams.get('prompt')).toBe('[Projeto Etus Design]: prj_1\n\noi');
    expect(url.searchParams.get('submit')).toBe('true');
    expect(initialChatEntry(DESIGN_AGENT_ID, 'conv 1')).toBe('/c/conv%201');
  });
});
