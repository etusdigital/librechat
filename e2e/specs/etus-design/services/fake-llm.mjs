import http from 'node:http';

const PORT = Number(process.env.FAKE_LLM_PORT ?? 4799);
const CHUNK_MS = Number(process.env.FAKE_LLM_CHUNK_MS ?? 120);
const PROJECT_PREFIX = '[Projeto Etus Design]: ';
const requests = [];

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
      const seen = summarize(body);
      requests.push(seen);
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
