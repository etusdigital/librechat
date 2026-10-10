jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const compression = require('compression');
const { logger } = require('@librechat/data-schemas');
const { createForwardTokenProvider } = require('../forwardToken');
const { createDesignProxy, getDesignProxyConfig, targetUrl } = require('../proxy');

const START = Date.parse('2026-10-10T12:00:00.000Z');
const CHAT_KEY = 'nxc_test_chat_key';
const CHAT_JWT = 'chat.session.jwt';
const KB = 1024;

const base64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const idTokenFor = (sub, expMs) =>
  `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url({ sub, exp: Math.floor(expMs / 1000) })}.sig-${sub}`;

const personWith = (id, idToken) => ({
  id,
  provider: 'openid',
  openidId: `sub-${id}`,
  federatedTokens: {
    access_token: `access-${id}`,
    id_token: idToken,
    expires_at: START / 1000 + 3600,
  },
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function startDesignService() {
  const received = [];
  const routes = new Map();
  const server = http.createServer((req, res) => {
    const entry = { method: req.method, url: req.url, headers: req.headers, bytes: 0, chunks: [] };
    entry.ended = false;
    entry.closedEarly = false;
    received.push(entry);
    req.on('data', (chunk) => {
      entry.bytes += chunk.length;
      entry.chunks.push(chunk);
    });
    req.on('end', () => (entry.ended = true));
    req.on('close', () => (entry.closedEarly = !entry.ended));
    const route = routes.get(new URL(req.url, 'http://x').pathname);
    if (route) {
      route(req, res, entry);
      return;
    }
    req.on('end', () => {
      res.setHeader('Set-Cookie', 'design_session=leak; Path=/');
      res.setHeader('Access-Control-Allow-Origin', 'https://evil.test');
      res.setHeader('X-Etus-Version', '3');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body: Buffer.concat(entry.chunks).toString('utf8'),
        }),
      );
    });
  });
  return listen(server).then(() => ({
    server,
    received,
    routes,
    origin: `http://127.0.0.1:${server.address().port}`,
  }));
}

function createHub(clock) {
  let issued = 0;
  const fetchImpl = jest.fn(async () => {
    issued += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        token: `fwd.${issued}`,
        tokenType: 'Bearer',
        expiresAt: new Date(clock.now + 60_000).toISOString(),
        expiresIn: 60,
      }),
    };
  });
  return fetchImpl;
}

const loggedText = () =>
  JSON.stringify(['debug', 'info', 'warn', 'error'].flatMap((level) => logger[level].mock.calls));

describe('design proxy', () => {
  let design;
  let clock;
  let hubFetch;
  let tokens;
  let config;
  let people;
  let app;

  const buildApp = (proxyOptions = {}) => {
    const proxy = createDesignProxy({
      getConfig: () => config,
      tokens,
      now: () => clock.now,
      ...proxyOptions,
    });
    const instance = express();
    instance.use(express.json({ limit: '3mb' }));
    instance.use(express.urlencoded({ extended: true, limit: '3mb' }));
    instance.use(compression());
    instance.use((req, _res, next) => {
      req.user = people[req.headers['x-test-person']];
      next();
    });
    instance.use('/api/etus/design', proxy);
    return instance;
  };

  beforeAll(async () => {
    design = await startDesignService();
  });

  afterAll(async () => {
    await close(design.server);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    design.received.length = 0;
    design.routes.clear();
    clock = { now: START };
    hubFetch = createHub(clock);
    tokens = createForwardTokenProvider({
      getConfig: () => ({ url: 'https://hub.test', key: CHAT_KEY }),
      fetchImpl: hubFetch,
      now: () => clock.now,
    });
    config = {
      origin: design.origin,
      basePath: '',
      uploadLimitMb: 25,
      bodyLimitBytes: 25 * 1024 * KB,
    };
    people = {
      ana: personWith('ana', idTokenFor('ana', START + 3600_000)),
      bia: personWith('bia', idTokenFor('bia', START + 3600_000)),
      noToken: { id: 'noToken', provider: 'openid', openidId: 'sub-noToken' },
      expiring: personWith('expiring', idTokenFor('expiring', START + 10_000)),
      local: { id: 'local', provider: 'local' },
    };
    app = buildApp();
  });

  describe('C-17: token from the hub', () => {
    it('asks the hub with the chat key and the person id token, then calls the design-service with the forward token', async () => {
      const response = await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      expect(response.status).toBe(200);
      expect(hubFetch).toHaveBeenCalledTimes(1);
      const [url, init] = hubFetch.mock.calls[0];
      expect(url).toBe('https://hub.test/api/v1/mcp/forward-tokens');
      expect(init.headers.Authorization).toBe(`Bearer ${CHAT_KEY}`);
      expect(init.headers['X-Etus-Id-Token']).toBe(people.ana.federatedTokens.id_token);
      expect(JSON.parse(init.body)).toEqual({ appKey: 'design' });
      expect(design.received).toHaveLength(1);
      expect(design.received[0].url).toBe('/v1/me');
      expect(design.received[0].headers.authorization).toBe('Bearer fwd.1');
    });

    it('reuses the token for up to 45 seconds per person', async () => {
      await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      clock.now += 44_000;
      await request(app).get('/api/etus/design/projects').set('x-test-person', 'ana');
      expect(hubFetch).toHaveBeenCalledTimes(1);
      await request(app).get('/api/etus/design/me').set('x-test-person', 'bia');
      expect(hubFetch).toHaveBeenCalledTimes(2);
      clock.now += 1_000;
      await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      expect(hubFetch).toHaveBeenCalledTimes(3);
      expect(design.received.map((entry) => entry.headers.authorization)).toEqual([
        'Bearer fwd.1',
        'Bearer fwd.1',
        'Bearer fwd.2',
        'Bearer fwd.3',
      ]);
    });

    it('asks the hub once for parallel requests of the same person', async () => {
      await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app).get('/api/etus/design/projects').set('x-test-person', 'ana'),
        ),
      );
      expect(hubFetch).toHaveBeenCalledTimes(1);
      expect(design.received).toHaveLength(6);
    });

    it('never sends the id token, the chat session or cookies to the design-service', async () => {
      const response = await request(app)
        .post('/api/etus/design/projects')
        .set('x-test-person', 'ana')
        .set('Authorization', `Bearer ${CHAT_JWT}`)
        .set('Cookie', 'refreshToken=r1; connect.sid=s1; token_provider=openid')
        .set('X-Etus-Id-Token', 'browser.id.token')
        .set('X-Etus-Hub-Token', 'browser.hub.token')
        .set('X-Etus-Router-Grant', 'browser.grant')
        .set('X-Etus-Anything', 'x')
        .set('Origin', 'https://chat-ai.etus.test')
        .set('Referer', 'https://chat-ai.etus.test/design')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ name: 'Landing' });
      expect(response.status).toBe(200);
      const { headers } = design.received[0];
      expect(headers.authorization).toBe('Bearer fwd.1');
      for (const name of [
        'cookie',
        'x-etus-id-token',
        'x-etus-hub-token',
        'x-etus-router-grant',
        'x-etus-anything',
        'origin',
        'referer',
        'x-forwarded-for',
        'x-test-person',
      ]) {
        expect(headers).not.toHaveProperty(name);
      }
      const sent = JSON.stringify(headers);
      expect(sent).not.toContain(people.ana.federatedTokens.id_token);
      expect(sent).not.toContain(CHAT_JWT);
      expect(sent).not.toContain('access-ana');
    });

    it('maps a hub refusal to 403 design_not_allowed without calling the design-service', async () => {
      hubFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ error: 'no_app_access' }),
      });
      const response = await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: {
          code: 'design_not_allowed',
          message: 'Você não tem acesso ao Etus Design. Fale com a administração do hub.',
        },
      });
      expect(design.received).toHaveLength(0);
    });

    it('maps a hub that is down to 503 hub_unavailable and never uses an expired token', async () => {
      await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      clock.now += 61_000;
      hubFetch.mockRejectedValueOnce(new TypeError('fetch failed'));
      const response = await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('hub_unavailable');
      expect(response.headers['retry-after']).toBe('5');
      expect(design.received).toHaveLength(1);
    });

    it('answers 401 reauth_required without an id token and does not call the hub', async () => {
      for (const person of ['noToken', 'expiring', 'local', 'nobody']) {
        const response = await request(app).get('/api/etus/design/me').set('x-test-person', person);
        expect(response.status).toBe(401);
        expect(response.body.error).toEqual({
          code: 'reauth_required',
          message: 'Sua sessão expirou. Entre de novo.',
        });
      }
      expect(hubFetch).not.toHaveBeenCalled();
      expect(design.received).toHaveLength(0);
    });

    it('drops the cached token when the design-service refuses it', async () => {
      design.routes.set('/v1/me', (req, res) => {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.end(JSON.stringify({ error: 'unauthenticated' }));
      });
      const refused = await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      expect(refused.status).toBe(502);
      expect(refused.body.error.code).toBe('design_auth_failed');
      expect(refused.headers['www-authenticate']).toBeUndefined();
      await request(app).get('/api/etus/design/projects').set('x-test-person', 'ana');
      expect(hubFetch).toHaveBeenCalledTimes(2);
      expect(design.received[1].headers.authorization).toBe('Bearer fwd.2');
    });

    it('never logs tokens', async () => {
      await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      design.routes.set('/v1/me', (req, res) => {
        res.statusCode = 401;
        res.end();
      });
      await request(app).get('/api/etus/design/me').set('x-test-person', 'ana');
      const text = loggedText();
      expect(text).not.toContain('fwd.');
      expect(text).not.toContain(people.ana.federatedTokens.id_token);
      expect(text).not.toContain(CHAT_KEY);
    });
  });

  describe('request forwarding', () => {
    it('maps /api/etus/design/* to /v1/* and keeps the query string', async () => {
      await request(app)
        .get('/api/etus/design/projects/prj_1/files/content?path=pages%2Findex.html&v=2')
        .set('x-test-person', 'ana');
      expect(design.received[0].url).toBe(
        '/v1/projects/prj_1/files/content?path=pages%2Findex.html&v=2',
      );
    });

    it('keeps a base path from ETUS_DESIGN_URL', async () => {
      design.routes.set('/svc/v1/me', (req, res) => res.end('{}'));
      config = { ...config, basePath: '/svc' };
      await request(buildApp()).get('/api/etus/design/me').set('x-test-person', 'ana');
      expect(design.received[0].url).toBe('/svc/v1/me');
    });

    it('lets X-Etus-Version-Source and the encoded X-Etus-Note through with conditional headers', async () => {
      const note = encodeURIComponent('Título ajustado na tela ✓');
      await request(app)
        .put('/api/etus/design/projects/prj_1/files/content?path=index.html')
        .set('x-test-person', 'ana')
        .set('Content-Type', 'text/html')
        .set('If-Match', '"abc"')
        .set('X-Etus-Version-Source', 'inline_edit')
        .set('X-Etus-Note', note)
        .send('<h1>Oi</h1>');
      const { headers } = design.received[0];
      expect(headers['x-etus-version-source']).toBe('inline_edit');
      expect(headers['x-etus-note']).toBe(note);
      expect(headers['if-match']).toBe('"abc"');
      expect(headers['content-type']).toBe('text/html');
      expect(Buffer.concat(design.received[0].chunks).toString()).toBe('<h1>Oi</h1>');
    });

    it('refuses an X-Etus-Note that is not percent-encoded', async () => {
      const response = await request(app)
        .put('/api/etus/design/projects/prj_1/files/content?path=index.html')
        .set('x-test-person', 'ana')
        .set('Content-Type', 'text/plain')
        .set('X-Etus-Note', 'café')
        .send('x');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_header');
      expect(hubFetch).not.toHaveBeenCalled();
      expect(design.received).toHaveLength(0);
    });

    it('sends a JSON body the chat already parsed as JSON again', async () => {
      const body = { name: 'Landing', brief: 'Página com acentuação', tags: ['a', 'b'] };
      await request(app).post('/api/etus/design/projects').set('x-test-person', 'ana').send(body);
      const entry = design.received[0];
      expect(entry.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(Number(entry.headers['content-length'])).toBe(entry.bytes);
      expect(JSON.parse(Buffer.concat(entry.chunks).toString('utf8'))).toEqual(body);
    });

    it('refuses url-encoded bodies, which the chat parses before the proxy', async () => {
      const response = await request(app)
        .post('/api/etus/design/projects')
        .set('x-test-person', 'ana')
        .type('form')
        .send({ name: 'x' });
      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe('unsupported_media_type');
      expect(design.received).toHaveLength(0);
    });

    it('forwards bodiless methods without a body', async () => {
      const response = await request(app)
        .delete('/api/etus/design/projects/prj_1')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(200);
      expect(design.received[0]).toMatchObject({ method: 'DELETE', bytes: 0 });
      expect(design.received[0].headers['content-length']).toBeUndefined();
    });

    it('answers HEAD', async () => {
      const response = await request(app).head('/api/etus/design/me').set('x-test-person', 'ana');
      expect(response.status).toBe(200);
      expect(design.received[0].method).toBe('HEAD');
    });

    it.each(['OPTIONS', 'TRACE'])('refuses %s with 405', async (method) => {
      const response = await request(app)
        [method.toLowerCase()]('/api/etus/design/me')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(405);
      expect(design.received).toHaveLength(0);
    });

    it.each([
      '/api/etus/design',
      '/api/etus/design/',
      '/api/etus/design/%2e%2e/api/mcp',
      '/api/etus/design/projects/%2E%2E/%2e%2e/health',
      '/api/etus/design/..%2F..%2Fapi%2Fmcp',
      '/api/etus/design/projects//prj_1',
      '/api/etus/design/projects/%5C..',
      '/api/etus/design/projects/%00',
    ])('answers 404 for %s without calling anyone', async (path) => {
      const response = await request(app).get(path).set('x-test-person', 'ana');
      expect(response.status).toBe(404);
      expect(hubFetch).not.toHaveBeenCalled();
      expect(design.received).toHaveLength(0);
    });

    it('answers 404 design_disabled when ETUS_DESIGN_URL is not set', async () => {
      config = null;
      const response = await request(buildApp())
        .get('/api/etus/design/me')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('design_disabled');
      expect(hubFetch).not.toHaveBeenCalled();
    });
  });

  describe('responses', () => {
    it('passes the design-service response through without its cookies or CORS headers', async () => {
      design.routes.set('/v1/projects/prj_1/files/content', (req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Etus-Mime', 'text/html');
        res.setHeader('ETag', '"sha"');
        res.setHeader('Content-Disposition', 'attachment; filename="index.html"');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'; sandbox",
        );
        res.setHeader('Set-Cookie', ['a=1', 'b=2']);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Server', 'design-service');
        res.end('<html><body>Oi</body></html>');
      });
      const response = await request(app)
        .get('/api/etus/design/projects/prj_1/files/content?path=index.html')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(200);
      expect(response.text).toBe('<html><body>Oi</body></html>');
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.headers['x-etus-mime']).toBe('text/html');
      expect(response.headers.etag).toBe('"sha"');
      expect(response.headers['content-disposition']).toBe('attachment; filename="index.html"');
      expect(response.headers['content-security-policy']).toContain('sandbox');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers.server).toBeUndefined();
    });

    it('keeps the design-service status and error body', async () => {
      design.routes.set('/v1/projects/prj_x', (req, res) => {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 'not_found', message: 'Não encontrado.' } }));
      });
      const response = await request(app)
        .get('/api/etus/design/projects/prj_x')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('not_found');
    });

    it('answers 502 design_unavailable when the design-service is down', async () => {
      const closed = await listen(http.createServer());
      const port = closed.address().port;
      await close(closed);
      config = { ...config, origin: `http://127.0.0.1:${port}` };
      const response = await request(buildApp())
        .get('/api/etus/design/me')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(502);
      expect(response.body.error.code).toBe('design_unavailable');
    });

    it('answers 504 design_timeout when the design-service does not answer in time', async () => {
      design.routes.set('/v1/slow', () => {});
      const response = await request(buildApp({ timeoutMs: 150 }))
        .get('/api/etus/design/slow')
        .set('x-test-person', 'ana');
      expect(response.status).toBe(504);
      expect(response.body.error.code).toBe('design_timeout');
    });
  });

  describe('streaming and limits', () => {
    let server;
    let port;

    beforeEach(async () => {
      server = await listen(http.createServer(app));
      port = server.address().port;
    });

    afterEach(async () => {
      server.closeAllConnections();
      await close(server);
    });

    const proxyRequest = (method, path, headers = {}) =>
      http.request({
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { 'x-test-person': 'ana', ...headers },
      });

    const collect = (res) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

    const waitFor = async (condition) => {
      const deadline = Date.now() + 5000;
      while (!condition()) {
        if (Date.now() > deadline) {
          throw new Error('condition not met');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    it('streams downloads to the browser before the design-service finishes', async () => {
      let release;
      const released = new Promise((resolve) => (release = resolve));
      const first = crypto.randomBytes(256 * KB);
      const rest = crypto.randomBytes(4 * 1024 * KB);
      design.routes.set('/v1/exports/exp_1/download', async (req, res) => {
        res.setHeader('Content-Type', 'application/zip');
        res.write(first);
        await released;
        res.end(rest);
      });
      const req = proxyRequest('GET', '/api/etus/design/exports/exp_1/download');
      const res = await new Promise((resolve) => req.on('response', resolve).end());
      expect(res.statusCode).toBe(200);
      const chunks = [];
      let received = 0;
      const gotFirstChunk = new Promise((resolve) =>
        res.on('data', (chunk) => {
          chunks.push(chunk);
          received += chunk.length;
          resolve();
        }),
      );
      const ended = new Promise((resolve) => res.on('end', resolve));
      await gotFirstChunk;
      expect(received).toBeGreaterThan(0);
      expect(received).toBeLessThanOrEqual(first.length);
      release();
      await ended;
      const body = Buffer.concat(chunks);
      expect(body.equals(Buffer.concat([first, rest]))).toBe(true);
    });

    it('streams uploads to the design-service before the browser finishes sending', async () => {
      design.routes.set('/v1/projects/prj_1/files/upload', (req, res, entry) => {
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ bytes: entry.bytes }));
        });
      });
      const part = crypto.randomBytes(512 * KB);
      const req = proxyRequest('POST', '/api/etus/design/projects/prj_1/files/upload', {
        'Content-Type': 'multipart/form-data; boundary=x',
      });
      const responded = new Promise((resolve) => req.on('response', resolve));
      req.write(part);
      await waitFor(() => design.received[0]?.bytes >= part.length / 2);
      expect(design.received[0].ended).toBe(false);
      req.end(part);
      const res = await responded;
      const body = JSON.parse((await collect(res)).toString());
      expect(res.statusCode).toBe(200);
      expect(body.bytes).toBe(2 * part.length);
      expect(Buffer.concat(design.received[0].chunks).equals(Buffer.concat([part, part]))).toBe(
        true,
      );
      expect(design.received[0].headers['transfer-encoding']).toBe('chunked');
    });

    it('refuses a declared body above the limit before asking the hub', async () => {
      config = { ...config, uploadLimitMb: 1, bodyLimitBytes: 100 * KB };
      const req = proxyRequest('POST', '/api/etus/design/projects/prj_1/files/upload', {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(200 * KB),
      });
      const responded = new Promise((resolve) => req.on('response', resolve));
      req.on('error', () => {});
      req.write(Buffer.alloc(16 * KB));
      const res = await responded;
      const body = JSON.parse((await collect(res)).toString());
      expect(res.statusCode).toBe(413);
      expect(body.error).toMatchObject({ code: 'payload_too_large', details: { limitMb: 1 } });
      expect(hubFetch).not.toHaveBeenCalled();
      expect(design.received).toHaveLength(0);
      req.destroy();
    });

    it('cuts a streamed body that grows above the limit and aborts the upstream request', async () => {
      config = { ...config, uploadLimitMb: 1, bodyLimitBytes: 100 * KB };
      design.routes.set('/v1/projects/prj_1/files/upload', () => {});
      const req = proxyRequest('POST', '/api/etus/design/projects/prj_1/files/upload', {
        'Content-Type': 'application/octet-stream',
      });
      const responded = new Promise((resolve) => req.on('response', resolve));
      req.on('error', () => {});
      req.write(Buffer.alloc(64 * KB));
      await waitFor(() => design.received.length === 1);
      req.write(Buffer.alloc(64 * KB));
      const res = await responded;
      const body = JSON.parse((await collect(res)).toString());
      expect(res.statusCode).toBe(413);
      expect(body.error.code).toBe('payload_too_large');
      await waitFor(() => design.received[0].closedEarly);
      expect(design.received[0].bytes).toBeLessThanOrEqual(100 * KB);
      req.destroy();
    });

    it('aborts the upstream request when the browser goes away', async () => {
      design.routes.set('/v1/projects/prj_1/files/upload', () => {});
      const req = proxyRequest('POST', '/api/etus/design/projects/prj_1/files/upload', {
        'Content-Type': 'application/octet-stream',
      });
      req.on('error', () => {});
      req.write(Buffer.alloc(16 * KB));
      await waitFor(() => design.received[0]?.bytes > 0);
      req.destroy();
      await waitFor(() => design.received[0].closedEarly);
      expect(design.received[0].ended).toBe(false);
    });
  });
});

describe('targetUrl', () => {
  const config = { origin: 'http://design-service:8080', basePath: '' };
  const target = (url) => targetUrl({ url }, config)?.toString() ?? null;

  it.each([
    ['/me', 'http://design-service:8080/v1/me'],
    ['/me/', 'http://design-service:8080/v1/me/'],
    [
      '/projects/prj_1/files/content?path=../../etc/passwd',
      'http://design-service:8080/v1/projects/prj_1/files/content?path=../../etc/passwd',
    ],
    [
      '/projects/prj_1/files?path=a%20b',
      'http://design-service:8080/v1/projects/prj_1/files?path=a%20b',
    ],
  ])('maps %s', (url, expected) => {
    expect(target(url)).toBe(expected);
  });

  it.each([
    '',
    '/',
    '//evil.test/v1/me',
    '/../api/mcp',
    '/./me',
    '/me/..',
    '/%2e%2e/api/mcp',
    '/%2E/me',
    '/..%2fapi',
    '/a%2Fb',
    '/a%5Cb',
    '/a\\b',
    '/a b',
    '/a%00',
    '/a%ZZ',
    'me',
    'http://evil.test/v1/me',
  ])('refuses %j', (url) => {
    expect(target(url)).toBeNull();
  });
});

describe('getDesignProxyConfig', () => {
  const keys = ['ETUS_DESIGN_URL', 'ETUS_DESIGN_MAX_UPLOAD_MB'];
  afterEach(() => keys.forEach((key) => delete process.env[key]));

  it('is off without ETUS_DESIGN_URL', () => {
    expect(getDesignProxyConfig()).toBeNull();
  });

  it('reads the compose address with the default 25 MB limit', () => {
    process.env.ETUS_DESIGN_URL = 'http://design-service:8080/';
    expect(getDesignProxyConfig()).toEqual({
      origin: 'http://design-service:8080',
      basePath: '',
      uploadLimitMb: 25,
      bodyLimitBytes: 25 * 1024 * 1024 + 512 * 1024,
    });
  });

  it('follows ETUS_DESIGN_MAX_UPLOAD_MB', () => {
    process.env.ETUS_DESIGN_URL = 'http://design-service:8080';
    process.env.ETUS_DESIGN_MAX_UPLOAD_MB = '40';
    expect(getDesignProxyConfig()).toMatchObject({ uploadLimitMb: 40 });
    process.env.ETUS_DESIGN_MAX_UPLOAD_MB = 'lots';
    expect(getDesignProxyConfig()).toMatchObject({ uploadLimitMb: 25 });
  });

  it.each([
    'ftp://design-service',
    'not a url',
    'http://user:pass@design-service:8080',
    'http://design-service:8080/?x=1',
  ])('refuses %s', (value) => {
    process.env.ETUS_DESIGN_URL = value;
    expect(getDesignProxyConfig()).toBeNull();
  });
});
