import http from 'node:http';

const PORT = Number(process.env.FAKE_LLM_PORT ?? 4799);
const CHUNK_MS = Number(process.env.FAKE_LLM_CHUNK_MS ?? 120);
const PROJECT_PREFIX = '[Projeto Etus Design]: ';
const requests = [];
const JURY_COST_USD = '0.0123';

export const JURY_VERDICT = {
  scores: { visual: 7.5, brand: 8.5, accessibility: 7, copy: 8 },
  mustFix: [
    {
      dimension: 'copy',
      severity: 'major',
      issue: 'Título genérico demais para a oferta',
      where: 'section.hero h1',
      fix: 'Diga em uma frase o que o produto faz',
    },
  ],
  niceToHave: [
    {
      dimension: 'visual',
      issue: 'Espaço vertical irregular entre as seções',
      fix: 'Use a escala de espaçamento do DESIGN.md',
    },
  ],
  summary: 'Base boa, com contraste e título a corrigir.',
};

const isJury = (body) => body?.response_format?.type === 'json_schema';

const textOf = (message) => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content ?? [])
    .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
    .join('\n');
};

const imagesOf = (message) =>
  Array.isArray(message?.content)
    ? message.content.filter((part) => part.type === 'image_url').length
    : 0;

function summarize(body) {
  const users = (body.messages ?? []).filter((message) => message.role === 'user');
  const first = textOf(users[0]);
  return {
    at: Date.now(),
    model: body.model,
    firstLine: first.split('\n')[0],
    first,
    last: textOf(users[users.length - 1]),
    userMessages: users.length,
    lastImages: imagesOf(users[users.length - 1]),
  };
}

function reply(seen) {
  const project = seen.firstLine.startsWith(PROJECT_PREFIX)
    ? seen.firstLine.slice(PROJECT_PREFIX.length)
    : 'ausente';
  return [
    `Projeto visto pelo modelo: ${project}.`,
    '',
    `Mensagens da pessoa: ${seen.userMessages}.`,
    '',
    '## Próximos passos',
    '',
    '1. Adicionar seção de FAQ',
    '2. Trocar a cor do botão principal',
    '3. Exportar em PDF',
  ].join('\n');
}

const chunk = (id, model, delta, finish = null) =>
  `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (part) => {
      raw += part;
    });
    req.on('end', async () => {
      if (req.url === '/__requests') return json(res, 200, requests);
      if (req.url === '/v1/etus/hub-grants' && req.method === 'POST') {
        if (!req.headers['x-etus-hub-token']) return json(res, 401, { error: 'no_hub_token' });
        return json(res, 201, {
          grant: `rhg_e2e_${Date.now().toString(36)}`,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
      }
      if (req.url?.startsWith('/v1/models')) {
        return json(res, 200, {
          data: [{ id: 'cc/claude-sonnet-5' }, { id: 'rapido' }].map((model) => ({
            ...model,
            object: 'model',
          })),
        });
      }
      if (!req.url?.startsWith('/v1/chat/completions')) {
        res.writeHead(404).end();
        return undefined;
      }
      const body = JSON.parse(raw || '{}');
      const seen = { ...summarize(body), jury: isJury(body) };
      requests.push(seen);
      if (seen.jury) {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-omniroute-response-cost': JURY_COST_USD,
        });
        res.end(
          JSON.stringify({
            id: `chatcmpl-${requests.length}`,
            object: 'chat.completion',
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: JSON.stringify(JURY_VERDICT) },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        );
        return undefined;
      }
      const text = reply(seen);
      const id = `chatcmpl-${requests.length}`;
      if (!body.stream) {
        return json(res, 200, {
          id,
          object: 'chat.completion',
          model: body.model,
          choices: [
            { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const piece of text.match(/.{1,16}/gs) ?? []) {
        res.write(chunk(id, body.model, { content: piece }));
        await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
      }
      res.write(chunk(id, body.model, {}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
      return undefined;
    });
  })
  .listen(PORT, '0.0.0.0', () => process.stdout.write(`fake model on ${PORT}\n`));
