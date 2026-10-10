import http from 'node:http';

const PORT = Number(process.env.FAKE_LLM_PORT ?? 4799);
const CHUNK_MS = Number(process.env.FAKE_LLM_CHUNK_MS ?? 300);
const requests = [];
const images = [];

const textOf = (message) => {
  if (!message) {
    return '';
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  return (message.content ?? [])
    .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
    .join('\n');
};

const imageUrlsOf = (message) =>
  Array.isArray(message?.content)
    ? message.content
        .filter((part) => part.type === 'image_url')
        .map((part) => part.image_url?.url ?? part.image_url)
    : [];

function summarize(body) {
  const users = (body.messages ?? []).filter((message) => message.role === 'user');
  const lastImages = imageUrlsOf(users[users.length - 1]);
  images.push(...lastImages);
  return {
    model: body.model,
    firstLine: textOf(users[0]).split('\n')[0],
    first: textOf(users[0]),
    last: textOf(users[users.length - 1]),
    userMessages: users.length,
    lastImages: lastImages.length,
  };
}

function reply(seen) {
  const linked = seen.firstLine.startsWith('[Projeto Etus Design]: ')
    ? seen.firstLine.slice('[Projeto Etus Design]: '.length)
    : 'ausente';
  return [
    `Projeto visto pelo modelo: ${linked}.`,
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

function chunk(id, model, delta, finish = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (part) => {
      raw += part;
    });
    req.on('end', async () => {
      if (req.url === '/__images') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(images));
        return;
      }
      if (req.url === '/__requests') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(requests));
        return;
      }
      if (!req.url?.startsWith('/v1/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw || '{}');
      const seen = summarize(body);
      requests.push(seen);
      const text = reply(seen);
      const id = `chatcmpl-${requests.length}`;
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id,
            object: 'chat.completion',
            model: body.model,
            choices: [
              { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      for (const piece of text.match(/.{1,12}/gs) ?? []) {
        res.write(chunk(id, body.model, { content: piece }));
        await new Promise((resolve) => setTimeout(resolve, CHUNK_MS));
      }
      res.write(chunk(id, body.model, {}, 'stop'));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake model on ${PORT}`));
