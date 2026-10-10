const http = require('node:http');
const crypto = require('node:crypto');

const APP_KEY = 'design';
const ORG_ID = 'org_etus';
const SERVICE_KEY = 'e2e-design-service-key';
const CHAT_KEY = 'e2e-chat-mcp-key';
const FORWARD_TOKEN_TTL_S = 60;
const PERMISSIONS = ['projects.use', 'projects.share-company', 'projects.share-public'];

const base64url = (value) => Buffer.from(value).toString('base64url');

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startFakeHub({ port = 0, people = {} } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = 'e2e-hub-key';
  const jwks = {
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }],
  };
  const calls = [];
  let issuer = '';

  const signForwardToken = (sub) => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        iss: issuer,
        aud: APP_KEY,
        sub,
        org: ORG_ID,
        scope: 'mcp',
        via: 'chat',
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + FORWARD_TOKEN_TTL_S,
      }),
    );
    const signature = crypto
      .sign('sha256', Buffer.from(`${header}.${payload}`), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      .toString('base64url');
    return `${header}.${payload}.${signature}`;
  };

  const personOf = (sub) =>
    people[sub] ?? {
      email: `${sub}@etus.test`,
      displayName: 'Pessoa E2E',
      permissions: PERMISSIONS,
    };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const body = await readBody(req);
    calls.push({ method: req.method, path: url.pathname });
    const authorization = req.headers.authorization ?? '';

    if (url.pathname === '/.well-known/jwks.json') {
      return sendJson(res, 200, jwks);
    }
    if (url.pathname === '/api/v1/mcp/forward-tokens' && req.method === 'POST') {
      if (authorization !== `Bearer ${CHAT_KEY}`) {
        return sendJson(res, 401, { error: 'invalid_key' });
      }
      const claims = decodeJwtPayload(req.headers['x-etus-id-token']);
      if (!claims?.sub || JSON.parse(body || '{}').appKey !== APP_KEY) {
        return sendJson(res, 401, { error: 'invalid_id_token' });
      }
      const expiresAt = new Date(Date.now() + FORWARD_TOKEN_TTL_S * 1000).toISOString();
      return sendJson(res, 200, {
        token: signForwardToken(claims.sub),
        expiresIn: FORWARD_TOKEN_TTL_S,
        expiresAt,
      });
    }
    if (authorization !== `Bearer ${SERVICE_KEY}`) {
      return sendJson(res, 401, { error: 'invalid_service_key' });
    }
    if (
      req.method === 'PUT' &&
      /^\/api\/v1\/apps\/design\/(manifest|settings-catalog)$/.test(url.pathname)
    ) {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/api/v1/access/version') {
      return sendJson(res, 200, { version: 1 });
    }
    if (url.pathname === '/api/v1/apps/design/settings') {
      return sendJson(res, 200, {
        version: 1,
        organization: { id: ORG_ID, name: 'Etus' },
        entries: [],
      });
    }
    const match = url.pathname.match(
      /^\/api\/v1\/apps\/design\/users\/([^/]+)\/(permissions|settings)$/,
    );
    if (match) {
      const person = personOf(decodeURIComponent(match[1]));
      const organization = { id: ORG_ID, slug: 'etus', name: 'Etus', role: 'member' };
      if (match[2] === 'permissions') {
        return sendJson(res, 200, {
          version: 1,
          user: {
            id: 'usr_e2e',
            email: person.email,
            displayName: person.displayName,
            active: true,
          },
          organization,
          permissions: person.permissions.map((key) => ({ key })),
        });
      }
      return sendJson(res, 200, { version: 1, active: true, organization, values: {} });
    }
    return sendJson(res, 404, { error: 'not_found' });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      issuer = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url: issuer,
        calls,
        serviceKey: SERVICE_KEY,
        chatKey: CHAT_KEY,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { startFakeHub, ORG_ID };
