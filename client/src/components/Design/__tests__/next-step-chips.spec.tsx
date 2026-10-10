import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import NextStepChips from '../workspace/next-steps/NextStepChips';

const mockChat = {
  sendMessage: jest.fn<Promise<boolean>, [string]>(),
  insertIntoComposer: jest.fn<Promise<boolean>, [string, File[]?]>(),
  lastText: null as string | null,
  responding: false,
};
const { sendMessage, insertIntoComposer } = mockChat;

jest.mock('../chat/DesignChatAdapter', () => ({
  __esModule: true,
  useIsResponding: () => mockChat.responding,
  useLastAssistantMessage: (conversationId: string | null) =>
    conversationId && mockChat.lastText != null ? { text: mockChat.lastText } : null,
  useDesignChatActions: () => ({
    sendMessage: mockChat.sendMessage,
    insertIntoComposer: mockChat.insertIntoComposer,
  }),
}));

const FORMATTED = [
  'Criei a landing com hero e preços.',
  '',
  '## Próximos passos',
  '',
  '1. Adicionar seção de FAQ',
  '2. Trocar a cor do botão principal',
  '3. Exportar em PDF',
].join('\n');

describe('NextStepChips (C-10)', () => {
  beforeEach(() => {
    sendMessage.mockReset().mockResolvedValue(true);
    insertIntoComposer.mockReset().mockResolvedValue(true);
    mockChat.lastText = FORMATTED;
    mockChat.responding = false;
  });

  it('shows the 3 suggestions of the last reply and sends the clicked one', async () => {
    render(<NextStepChips conversationId="conv-1" />);
    const nav = screen.getByRole('navigation', { name: 'Suggested next steps' });
    const buttons = screen.getAllByRole('button');
    expect(nav).toContainElement(buttons[0]);
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Adicionar seção de FAQ',
      'Trocar a cor do botão principal',
      'Exportar em PDF',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Trocar a cor do botão principal' }));
    expect(sendMessage).toHaveBeenCalledWith('Trocar a cor do botão principal');
    expect(insertIntoComposer).not.toHaveBeenCalled();
  });

  it('puts the suggestion in the composer when there is a draft', async () => {
    sendMessage.mockResolvedValue(false);
    render(<NextStepChips conversationId="conv-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar em PDF' }));
    await waitFor(() => expect(insertIntoComposer).toHaveBeenCalledWith('Exportar em PDF'));
  });

  it('disables the suggestions while the agent responds', () => {
    mockChat.responding = true;
    render(<NextStepChips conversationId="conv-1" />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('renders nothing without a reply in the format', () => {
    mockChat.lastText = 'Olá! Em que posso ajudar?';
    const { container, rerender } = render(<NextStepChips conversationId="conv-1" />);
    expect(container).toBeEmptyDOMElement();
    mockChat.lastText = FORMATTED;
    rerender(<NextStepChips conversationId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
