import http from 'node:http';
import crypto from 'node:crypto';

const IDP_ISSUER = process.env.IDP_ISSUER ?? 'https://idp.etus.test';
const HUB_ISSUER = process.env.HUB_ISSUER ?? 'https://hub.etus.test';
const CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'chat-e2e';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? 'e2e-oidc-client-secret';
const CHAT_KEY = process.env.HUB_CHAT_KEY ?? 'e2e-chat-mcp-key';
const SERVICE_KEY = process.env.HUB_SERVICE_KEY ?? 'e2e-design-service-key';
const APP_KEY = 'design';
const ORG = { id: 'org_etus', slug: 'etus', name: 'Etus', role: 'member' };
const TOKEN_TTL_S = Number(process.env.IDP_TOKEN_TTL_S ?? 3600);
const FORWARD_TOKEN_TTL_S = 60;

const DESIGNER = [
  'projects.use',
  'projects.share-company',
  'projects.share-public',
  'media.image',
  'media.video',
  'media.audio',
  'exports.pptx',
  'review.jury',
];
const COLLABORATOR = ['projects.use', 'projects.share-company', 'media.image'];
const ADMIN = [...DESIGNER, 'design-systems.set-default', 'admin.all'];

export const PERSONAS = {
  ana: { name: 'Ana Designer', permissions: DESIGNER },
  bia: { name: 'Bia Colaboradora', permissions: COLLABORATOR },
  carla: { name: 'Carla Admin', permissions: ADMIN },
  davi: { name: 'Davi Sem Acesso', permissions: [] },
  eva: { name: 'Eva Sem Júri', permissions: ['projects.use'] },
};

const emailOf = (persona) => `${persona}@etus.test`;
const subOf = (persona) => `logto-${persona}`;
const personaOfSub = (sub) => Object.keys(PERSONAS).find((key) => subOf(key) === sub);

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const RSA_KID = 'e2e-idp-key';
const EC_KID = 'e2e-hub-key';
const b64 = (value) => Buffer.from(value).toString('base64url');

function sign(payload, { alg, kid, typ = 'JWT' }) {
  const head = b64(JSON.stringify({ alg, kid, typ }));
  const body = b64(JSON.stringify(payload));
  const input = Buffer.from(`${head}.${body}`);
  const signature =
    alg === 'RS256'
      ? crypto.sign('sha256', input, rsa.privateKey)
      : crypto.sign('sha256', input, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${signature.toString('base64url')}`;
}

function verify(token, { alg }) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const input = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], 'base64url');
  const ok =
    alg === 'RS256'
      ? crypto.verify('sha256', input, rsa.publicKey, signature)
      : crypto.verify('sha256', input, { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (!ok) return null;
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  return claims.exp * 1000 > Date.now() ? claims : null;
}

const now = () => Math.floor(Date.now() / 1000);
const codes = new Map();
const refreshTokens = new Map();
const calls = [];
const companyValues = {};
let accessVersion = 1;
const overrides = new Map();

const permissionsOf = (persona) => overrides.get(persona) ?? PERSONAS[persona]?.permissions ?? [];

function tokensFor(persona, nonce) {
  const sub = subOf(persona);
  const iat = now();
  const profile = { email: emailOf(persona), email_verified: true, name: PERSONAS[persona].name };
  const idToken = sign(
    {
      iss: IDP_ISSUER,
      sub,
      aud: CLIENT_ID,
      iat,
      exp: iat + TOKEN_TTL_S,
      auth_time: iat,
      ...(nonce ? { nonce } : {}),
      ...profile,
      preferred_username: persona,
    },
    { alg: 'RS256', kid: RSA_KID },
  );
  const accessToken = sign(
    {
      iss: IDP_ISSUER,
      sub,
      aud: CLIENT_ID,
      client_id: CLIENT_ID,
      iat,
      exp: iat + TOKEN_TTL_S,
      scope: 'openid profile email offline_access',
      jti: crypto.randomUUID(),
      email: profile.email,
    },
    { alg: 'RS256', kid: RSA_KID, typ: 'at+jwt' },
  );
  const refreshToken = crypto.randomBytes(24).toString('base64url');
  refreshTokens.set(refreshToken, persona);
  return {
    access_token: accessToken,
    id_token: idToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_S,
    scope: 'openid profile email offline_access',
  };
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function cookiesOf(req) {
  return Object.fromEntries(
    String(req.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key]) => key),
  );
}

function clientAuthenticated(req, form) {
  const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
  if (basic) {
    const [id, secret] = Buffer.from(basic[1], 'base64')
      .toString('utf8')
      .split(':')
      .map(decodeURIComponent);
    return id === CLIENT_ID && secret === CLIENT_SECRET;
  }
  return form.get('client_id') === CLIENT_ID && form.get('client_secret') === CLIENT_SECRET;
}

async function idp(req, res) {
  const url = new URL(req.url, IDP_ISSUER);
  if (url.pathname === '/.well-known/openid-configuration') {
    return send(res, 200, {
      issuer: IDP_ISSUER,
      authorization_endpoint: `${IDP_ISSUER}/auth`,
      token_endpoint: `${IDP_ISSUER}/token`,
      userinfo_endpoint: `${IDP_ISSUER}/me`,
      jwks_uri: `${IDP_ISSUER}/jwks`,
      end_session_endpoint: `${IDP_ISSUER}/session/end`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
      claims_supported: ['sub', 'email', 'email_verified', 'name', 'preferred_username'],
    });
  }
  if (url.pathname === '/jwks') {
    return send(res, 200, {
      keys: [
        { ...rsa.publicKey.export({ format: 'jwk' }), kid: RSA_KID, alg: 'RS256', use: 'sig' },
      ],
    });
  }
  if (url.pathname === '/auth') {
    const params = url.searchParams;
    const persona = cookiesOf(req).e2e_persona ?? 'ana';
    if (params.get('client_id') !== CLIENT_ID || !PERSONAS[persona]) {
      return send(res, 400, { error: 'invalid_request' });
    }
    const code = crypto.randomBytes(16).toString('base64url');
    codes.set(code, {
      persona,
      nonce: params.get('nonce'),
      redirectUri: params.get('redirect_uri'),
      challenge: params.get('code_challenge'),
    });
    calls.push({ at: Date.now(), kind: 'login', persona });
    const target = new URL(params.get('redirect_uri'));
    target.searchParams.set('code', code);
    if (params.get('state')) target.searchParams.set('state', params.get('state'));
    res.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' });
    return res.end();
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req));
    if (!clientAuthenticated(req, form)) return send(res, 401, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      const entry = codes.get(form.get('code'));
      codes.delete(form.get('code'));
      if (!entry || entry.redirectUri !== form.get('redirect_uri')) {
        return send(res, 400, { error: 'invalid_grant' });
      }
      if (entry.challenge) {
        const verifier = form.get('code_verifier') ?? '';
        const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (digest !== entry.challenge) return send(res, 400, { error: 'invalid_grant' });
      }
      return send(res, 200, tokensFor(entry.persona, entry.nonce));
    }
    if (form.get('grant_type') === 'refresh_token') {
      const persona = refreshTokens.get(form.get('refresh_token'));
      if (!persona) return send(res, 400, { error: 'invalid_grant' });
      calls.push({ at: Date.now(), kind: 'refresh', persona });
      return send(res, 200, tokensFor(persona));
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }
  if (url.pathname === '/me') {
    const claims = verify((req.headers.authorization ?? '').replace(/^Bearer /, ''), {
      alg: 'RS256',
    });
    const persona = claims && personaOfSub(claims.sub);
    if (!persona) return send(res, 401, { error: 'invalid_token' });
    return send(res, 200, {
      sub: claims.sub,
      email: emailOf(persona),
      email_verified: true,
      name: PERSONAS[persona].name,
      preferred_username: persona,
    });
  }
  if (url.pathname === '/session/end') {
    res.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') ?? '/' });
    return res.end();
  }
  return send(res, 404, { error: 'not_found' });
}

function forwardToken(sub) {
  const iat = now();
  return sign(
    {
      iss: HUB_ISSUER,
      aud: APP_KEY,
      sub,
      org: ORG.id,
      scope: 'mcp',
      via: 'chat',
      jti: crypto.randomUUID(),
      iat,
      exp: iat + FORWARD_TOKEN_TTL_S,
    },
    { alg: 'ES256', kid: EC_KID },
  );
}

async function hub(req, res) {
  const url = new URL(req.url, HUB_ISSUER);
  const body = await readBody(req);
  const authorization = req.headers.authorization ?? '';
  if (url.pathname === '/.well-known/jwks.json') {
    return send(res, 200, {
      keys: [{ ...ec.publicKey.export({ format: 'jwk' }), kid: EC_KID, alg: 'ES256', use: 'sig' }],
    });
  }
  if (url.pathname === '/api/v1/mcp/forward-tokens' && req.method === 'POST') {
    const idClaims = verify(req.headers['x-etus-id-token'], { alg: 'RS256' });
    const persona = idClaims && personaOfSub(idClaims.sub);
    calls.push({
      at: Date.now(),
      kind: 'forward-token',
      persona: persona ?? null,
      chatKey: authorization === `Bearer ${CHAT_KEY}`,
      idToken: Boolean(idClaims),
      appKey: JSON.parse(body || '{}').appKey ?? null,
    });
    if (authorization !== `Bearer ${CHAT_KEY}`) return send(res, 401, { error: 'invalid_key' });
    if (!persona || idClaims.aud !== CLIENT_ID)
      return send(res, 401, { error: 'invalid_id_token' });
    if (JSON.parse(body || '{}').appKey !== APP_KEY)
      return send(res, 404, { error: 'app_not_found' });
    if (permissionsOf(persona).length === 0) return send(res, 403, { error: 'no_app_access' });
    return send(res, 200, {
      token: forwardToken(idClaims.sub),
      expiresIn: FORWARD_TOKEN_TTL_S,
      expiresAt: new Date((now() + FORWARD_TOKEN_TTL_S) * 1000).toISOString(),
    });
  }
  if (authorization !== `Bearer ${SERVICE_KEY}`) {
    return send(res, 401, { error: 'invalid_service_key' });
  }
  if (
    req.method === 'PUT' &&
    /^\/api\/v1\/apps\/design\/(manifest|settings-catalog)$/.test(url.pathname)
  ) {
    res.writeHead(204).end();
    return undefined;
  }
  if (url.pathname === '/api/v1/access/version') {
    return send(res, 200, { version: accessVersion });
  }
  if (url.pathname === '/api/v1/apps/design/settings') {
    return send(res, 200, {
      version: accessVersion,
      organization: { id: ORG.id, name: ORG.name },
      entries: [
        {
          groupId: 'company',
          subject: { kind: 'company', name: ORG.name },
          values: { ...companyValues },
        },
      ],
    });
  }
  const write = /^\/api\/v1\/apps\/design\/company-settings\/([^/]+)$/.exec(url.pathname);
  if (write && req.method === 'PUT') {
    const claims = verify(req.headers['x-etus-hub-token'], { alg: 'ES256' });
    const persona = claims && personaOfSub(claims.sub);
    const value = JSON.parse(body || '{}').value;
    calls.push({
      at: Date.now(),
      kind: 'company-setting',
      persona: persona ?? null,
      field: write[1],
      value,
      personToken: Boolean(claims) && claims.aud === APP_KEY,
    });
    if (!persona || claims.aud !== APP_KEY || claims.org !== ORG.id) {
      return send(res, 401, { error: 'invalid_token' });
    }
    if (write[1] !== 'defaultDesignSystem') return send(res, 404, { error: 'field_not_found' });
    if (!permissionsOf(persona).includes('design-systems.set-default')) {
      return send(res, 403, { error: 'missing_permission' });
    }
    companyValues.defaultDesignSystem = value;
    accessVersion += 1;
    return send(res, 200, {
      organizationId: ORG.id,
      key: write[1],
      value,
      version: accessVersion,
    });
  }
  const person = /^\/api\/v1\/apps\/design\/users\/([^/]+)\/(permissions|settings)$/.exec(
    url.pathname,
  );
  if (person) {
    const persona = personaOfSub(decodeURIComponent(person[1]));
    if (!persona) return send(res, 404, { error: 'user_not_found' });
    if (person[2] === 'permissions') {
      return send(res, 200, {
        version: accessVersion,
        user: {
          id: `usr_${persona}`,
          email: emailOf(persona),
          displayName: PERSONAS[persona].name,
          active: true,
        },
        organization: ORG,
        permissions: permissionsOf(persona).map((key) => ({ key })),
      });
    }
    return send(res, 200, { version: accessVersion, active: true, organization: ORG, values: {} });
  }
  return send(res, 404, { error: 'not_found' });
}

async function admin(req, res) {
  const url = new URL(req.url, 'http://admin');
  if (url.pathname === '/__calls') return send(res, 200, calls);
  if (url.pathname === '/__company') return send(res, 200, companyValues);
  if (url.pathname === '/__forward-token' && req.method === 'POST') {
    const { persona } = JSON.parse((await readBody(req)) || '{}');
    if (!PERSONAS[persona]) return send(res, 404, { error: 'unknown_persona' });
    return send(res, 200, { token: forwardToken(subOf(persona)) });
  }
  if (url.pathname === '/__permissions' && req.method === 'POST') {
    const { persona, permissions } = JSON.parse((await readBody(req)) || '{}');
    if (permissions) overrides.set(persona, permissions);
    else overrides.delete(persona);
    accessVersion += 1;
    return send(res, 200, { persona, permissions: permissionsOf(persona) });
  }
  return send(res, 404, { error: 'not_found' });
}

const serve = (handler, port) =>
  http
    .createServer((req, res) => {
      handler(req, res).catch((error) => {
        process.stderr.write(`${error.stack}\n`);
        send(res, 500, { error: 'internal' });
      });
    })
    .listen(port, '0.0.0.0');

serve(idp, Number(process.env.IDP_PORT ?? 4001));
serve(hub, Number(process.env.HUB_PORT ?? 4002));
serve(admin, Number(process.env.ADMIN_PORT ?? 4003));
process.stdout.write('fake idp, hub and admin listening\n');
