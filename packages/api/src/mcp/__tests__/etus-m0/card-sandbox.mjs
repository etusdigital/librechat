import http from 'node:http';

const CHAT_PORT = 4701;
const PREVIEW_PORT = 4702;
const hits = [];

const card = (ancestorsMode) => `<!doctype html><html><body style="font-family:sans-serif">
<p id="card">Card ${ancestorsMode}</p>
<iframe id="preview" src="http://localhost:${PREVIEW_PORT}/preview?mode=${ancestorsMode}" width="300" height="80"></iframe>
<p><a id="blank" href="http://localhost:${PREVIEW_PORT}/opened?via=blank" target="_blank">Abrir preview (nova aba)</a></p>
<p><a id="self" href="http://localhost:${PREVIEW_PORT}/opened?via=self">Abrir preview (mesma janela)</a></p>
<p><a id="top" href="http://localhost:${PREVIEW_PORT}/opened?via=top" target="_top">Abrir preview (topo)</a></p>
<img id="thumb" src="http://localhost:${PREVIEW_PORT}/thumb.svg" width="40">
</body></html>`;

const chatPage = (mode) => `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob: https: http://localhost:${PREVIEW_PORT}; frame-src 'self' https: blob: data: about: http://localhost:${PREVIEW_PORT}; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'">
</head><body>
<iframe id="card" sandbox="allow-scripts" width="600" height="300"></iframe>
<script>document.getElementById('card').srcdoc = ${JSON.stringify(card(mode))};</script>
</body></html>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${CHAT_PORT}`);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(chatPage(url.searchParams.get('mode') ?? 'chat-origin'));
  })
  .listen(CHAT_PORT, '127.0.0.1');

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PREVIEW_PORT}`);
    hits.push(
      `${url.pathname}${url.search} referer=${req.headers.referer ?? '-'} sec-fetch-dest=${req.headers['sec-fetch-dest'] ?? '-'}`,
    );
    if (url.pathname === '/hits') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(hits));
    }
    if (url.pathname === '/thumb.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      return res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>',
      );
    }
    const mode = url.searchParams.get('mode');
    const headers = { 'content-type': 'text/html' };
    if (mode === 'chat-origin')
      headers['content-security-policy'] = `frame-ancestors http://127.0.0.1:${CHAT_PORT}`;
    if (mode === 'star') headers['content-security-policy'] = 'frame-ancestors *';
    if (mode === 'none-header') {
    }
    res.writeHead(200, headers);
    res.end(`<!doctype html><body>PREVIEW_OK ${mode ?? ''} ${url.pathname}</body>`);
  })
  .listen(PREVIEW_PORT, 'localhost');

console.log('ready');
