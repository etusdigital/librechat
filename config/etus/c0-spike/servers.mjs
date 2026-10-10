import http from 'node:http';

const LLM_PORT = 4799;
const FRONT_PORT = 3180;
const CHAT_PORT = 3080;
const log = (...a) => console.log(new Date().toISOString(), ...a);

function lastUserText(body) {
  const msgs = body.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
    }
  }
  return '';
}

function firstUserText(body) {
  const m = (body.messages ?? []).find((x) => x.role === 'user');
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return (m.content ?? []).map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
}

function reply(body) {
  const first = firstUserText(body).split('\n')[0];
  const last = lastUserText(body);
  const hasImage = JSON.stringify(body.messages ?? []).includes('image_url');
  return [
    `Vínculo visto pelo modelo: ${first.startsWith('[Projeto Etus Design]: ') ? 'rótulo de definição, projectId=' + first.slice(23) : 'ausente'}`,
    '',
    `Última mensagem recebida (${last.length} caracteres)${hasImage ? ', com imagem anexada' : ''}.`,
    '',
    '## Próximos passos',
    '',
    '1. Adicionar seção de FAQ',
    '2. Trocar a cor do botão principal',
    '3. Exportar em PDF',
  ].join('\n');
}

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (!req.url.startsWith('/v1/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw || '{}');
      log(
        'LLM',
        'model=',
        body.model,
        'stream=',
        body.stream,
        'first=',
        JSON.stringify(firstUserText(body).split('\n')[0]),
      );
      const text = reply(body);
      const id = 'chatcmpl-fake';
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
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const chunks = text.match(/.{1,12}/gs) ?? [];
      for (const piece of chunks) {
        res.write(
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`,
        );
        await new Promise((r) => setTimeout(r, 60));
      }
      res.write(
        `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  })
  .listen(LLM_PORT, '127.0.0.1', () => log('fake LLM on', LLM_PORT));

const PREVIEW_HEADERS = {
  'content-security-policy':
    "sandbox allow-scripts allow-forms allow-popups; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:",
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
};

http
  .createServer((req, res) => {
    if (req.url.startsWith('/preview/')) {
      log(
        'PREVIEW',
        req.method,
        req.url.split('?')[0],
        'cookie=',
        req.headers.cookie ? 'sent' : '-',
        'sw=',
        req.headers['service-worker'] ?? '-',
      );
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-c0-source': 'network',
        ...PREVIEW_HEADERS,
      });
      res.end(
        `<!doctype html><html><head><title>prev</title></head><body><h1 id="h">Preview servida pela rede</h1><script>const h = document.getElementById('h'); h.dataset.origin = String(self.origin); try { h.dataset.controlled = String(Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)); } catch (e) { h.dataset.controlled = 'blocked: ' + e.message; }</script></body></html>`,
      );
      return;
    }
    const upstream = http.request(
      {
        host: 'localhost',
        port: CHAT_PORT,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `localhost:${FRONT_PORT}`, 'x-forwarded-proto': 'http' },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(FRONT_PORT, '127.0.0.1', () => log('front proxy on', FRONT_PORT));
