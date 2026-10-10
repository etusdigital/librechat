import { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  ChatPanel,
  withProjectLink,
  useIsResponding,
  useDesignChatActions,
  useLastAssistantMessage,
} from '../chat/DesignChatAdapter';

const DEBUG_LABELS = {
  conversation: 'conversa: ',
  newConversation: '(nova)',
  responding: 'respondendo: ',
  yes: 'sim',
  no: 'não',
  insert: 'Inserir texto',
  send: 'Enviar mensagem',
  result: 'resultado: ',
};

export function parseNextSteps(text: string): string[] {
  const match = /Próximos passos\s*\n+((?:\s*(?:\d+\.|[-*])\s+.+\n?){3})/i.exec(text);
  if (!match) {
    return [];
  }
  return match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+\.|[-*])\s+/, '').trim())
    .filter((line) => line !== '')
    .slice(0, 3);
}

export default function DesignChatSpikePage() {
  const { projectId = 'prj_spike' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversationId, setConversationId] = useState(searchParams.get('c') ?? undefined);
  const [lastResult, setLastResult] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isResponding = useIsResponding();
  const lastAssistant = useLastAssistantMessage(conversationId);
  const { insertIntoComposer, sendMessage } = useDesignChatActions();
  const brief = searchParams.get('brief') ?? 'landing para pequenas empresas';
  const steps = parseNextSteps(lastAssistant?.text ?? '');

  return (
    <div className="flex h-full w-full flex-col md:flex-row" data-testid="design-spike">
      <ChatPanel
        key={projectId}
        conversationId={conversationId}
        firstMessage={conversationId ? undefined : withProjectLink(projectId, brief)}
        onConversationCreated={(id) => {
          setConversationId(id);
          setSearchParams({ c: id }, { replace: true });
        }}
        className="flex h-1/2 min-h-0 w-full flex-col border-border-light md:h-full md:w-[440px] md:border-r"
      />
      <aside className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm text-text-primary">
        <div data-testid="spike-conversation">
          {DEBUG_LABELS.conversation}
          {conversationId ?? DEBUG_LABELS.newConversation}
        </div>
        <div data-testid="spike-responding">
          {DEBUG_LABELS.responding}
          {isResponding ? DEBUG_LABELS.yes : DEBUG_LABELS.no}
        </div>
        <pre
          data-testid="spike-last"
          className="whitespace-pre-wrap rounded border border-border-light p-2"
        >
          {lastAssistant?.text ?? '(sem resposta)'}
        </pre>
        <div className="flex flex-wrap gap-2" data-testid="spike-chips">
          {steps.map((step) => (
            <button
              key={step}
              type="button"
              disabled={isResponding}
              className="rounded-full border border-border-medium px-3 py-1"
              onClick={async () => setLastResult(String(await sendMessage(step)))}
            >
              {step}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="spike-insert"
            className="rounded border border-border-medium px-3 py-1"
            onClick={async () =>
              setLastResult(
                String(
                  await insertIntoComposer('Ajuste o arquivo index.html conforme os comentários.'),
                ),
              )
            }
          >
            {DEBUG_LABELS.insert}
          </button>
          <button
            type="button"
            data-testid="spike-send"
            className="rounded border border-border-medium px-3 py-1"
            onClick={async () =>
              setLastResult(String(await sendMessage('Aplique o design system Etus')))
            }
          >
            {DEBUG_LABELS.send}
          </button>
          <input
            ref={fileInputRef}
            data-testid="spike-file"
            type="file"
            className="text-xs"
            onChange={async (event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = '';
              setLastResult(
                String(
                  await insertIntoComposer(
                    'Veja as marcações na imagem e ajuste o arquivo index.html',
                    picked,
                  ),
                ),
              );
            }}
          />
        </div>
        <div data-testid="spike-result">
          {DEBUG_LABELS.result}
          {lastResult}
        </div>
        <iframe
          title="prévia"
          data-testid="spike-preview"
          src="/preview/p/spike-token/index.html"
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          className="h-48 w-full rounded border border-border-light"
        />
      </aside>
    </div>
  );
}
