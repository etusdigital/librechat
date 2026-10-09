import { Providers, initializeModel } from '@librechat/agents';
import type { Fetch } from './emptyChunks';
import { isEmptyCompletionChunk, withoutEmptyStreamChunks } from './emptyChunks';

const KEEPALIVE = {
  id: 'chatcmpl-keepalive',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'keepalive',
  choices: [{ index: 0, delta: {}, finish_reason: null }],
};

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'claude-haiku-4-5',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function event(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

const TOOL_CALL_STREAM = [
  event(KEEPALIVE),
  event(KEEPALIVE),
  event(chunk({ role: 'assistant' })),
  event(
    chunk({
      tool_calls: [
        {
          index: 0,
          id: 'toolu_1',
          type: 'function',
          function: { name: 'web_search', arguments: '' },
        },
      ],
    }),
  ),
  ...['{"query', '": "evolution ', 'foundation"}'].map((args) =>
    event(chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] })),
  ),
  event({
    ...chunk({}, 'tool_calls'),
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
  event('[DONE]'),
].join('');

function sseResponse(text: string, sliceSize = 7): Response {
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += sliceSize) {
        controller.enqueue(bytes.slice(offset, offset + sliceSize));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function searchModel(fetch: Fetch) {
  return initializeModel({
    provider: Providers.OPENAI,
    clientOptions: {
      model: 'rapido',
      apiKey: 'test-key',
      streaming: true,
      configuration: { baseURL: 'https://router.example.com/v1', fetch },
    },
    tools: [
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      },
    ],
  });
}

describe('isEmptyCompletionChunk', () => {
  it.each([
    ['a keepalive chunk with an empty delta', event(KEEPALIVE), true],
    ['the role chunk', event(chunk({ role: 'assistant' })), false],
    ['a content chunk', event(chunk({ content: 'Oi' })), false],
    ['the finish chunk', event(chunk({}, 'stop')), false],
    [
      'a usage chunk with an empty delta',
      event({ ...chunk({}), usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      false,
    ],
    ['a usage chunk without choices', event({ ...chunk({}), choices: [] }), false],
    ['the done marker', event('[DONE]'), false],
    ['an SSE comment', ': keepalive\n\n', false],
    ['a Responses API event', event({ type: 'response.in_progress' }), false],
    ['a non JSON payload', event('not json'), false],
  ])('detects %s', (_name, input, expected) => {
    expect(isEmptyCompletionChunk(input)).toBe(expected);
  });
});

describe('withoutEmptyStreamChunks', () => {
  it('drops keepalive chunks and keeps every other event byte for byte', async () => {
    const fetch = withoutEmptyStreamChunks(async () => sseResponse(TOOL_CALL_STREAM));

    const response = await fetch('https://router.example.com/v1/chat/completions');

    expect(await response.text()).toBe(TOOL_CALL_STREAM.replaceAll(event(KEEPALIVE), ''));
  });

  it('returns non streaming responses untouched', async () => {
    const original = Response.json({ ok: true });
    const fetch = withoutEmptyStreamChunks(async () => original);

    expect(await fetch('https://router.example.com/v1/chat/completions')).toBe(original);
  });

  it('keeps streamed tool calls when the gateway sends keepalives before the first delta', async () => {
    const model = searchModel(withoutEmptyStreamChunks(async () => sseResponse(TOOL_CALL_STREAM)));

    const result = await model.invoke('busca na web sobre a evolution foundation');

    expect(result.tool_calls).toEqual([
      expect.objectContaining({
        id: 'toolu_1',
        name: 'web_search',
        args: { query: 'evolution foundation' },
      }),
    ]);
  });

  it('loses the streamed tool call without the filter', async () => {
    const model = searchModel(async () => sseResponse(TOOL_CALL_STREAM));

    const result = await model.invoke('busca na web sobre a evolution foundation');

    expect(result.tool_calls ?? []).toEqual([]);
  });
});
