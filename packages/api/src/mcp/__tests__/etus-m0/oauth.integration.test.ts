import * as http from 'http';
import { MCPOAuthHandler } from '~/mcp/oauth';
import { getFreePort, trackSockets } from '~/mcp/__tests__/helpers/oauthTestServer';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  getTenantId: jest.fn(() => undefined),
  encryptV2: jest.fn(async (value: string) => value),
  decryptV2: jest.fn(async (value: string) => value),
}));

jest.mock('~/auth', () => ({
  createSSRFSafeUndiciConnect: jest.fn(() => undefined),
  isOAuthUrlAllowed: jest.fn(() => true),
  isSSRFTarget: jest.fn(() => false),
  resolveHostnameSSRF: jest.fn(async () => false),
}));

interface HubAuthServer {
  origin: string;
  registrations: Record<string, unknown>[];
  hits: string[];
  close: () => Promise<void>;
}

/** Serves the discovery documents the hub will serve (spec 3.1) and records registrations. */
async function startHubAuthServer(): Promise<HubAuthServer> {
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const registrations: Record<string, unknown>[] = [];
  const hits: string[] = [];
  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    hits.push(`${req.method} ${url.pathname}`);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json(200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['mcp', 'mcp:read'],
        bearer_methods_supported: ['header'],
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        revocation_endpoint: `${origin}/oauth/revoke`,
        jwks_uri: `${origin}/.well-known/jwks.json`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['mcp', 'mcp:read'],
        client_id_metadata_document_supported: true,
      });
    }
    if (url.pathname === '/oauth/register' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      registrations.push(body);
      return json(201, {
        ...body,
        client_id: `mcp_spike${registrations.length}`,
        client_id_issued_at: Math.floor(Date.now() / 1000),
      });
    }
    if (url.pathname === '/mcp') {
      return json(
        401,
        { error: 'unauthorized' },
        {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
        },
      );
    }
    return json(404, { error: 'not_found' });
  });
  const destroy = trackSockets(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
  return { origin, registrations, hits, close: destroy };
}

describe('M0 spike Q5: LibreChat MCP OAuth against a hub-shaped authorization server', () => {
  let hub: HubAuthServer;
  const previousDomain = process.env.DOMAIN_SERVER;

  beforeEach(async () => {
    process.env.DOMAIN_SERVER = 'https://chat.etus.test';
    hub = await startHubAuthServer();
  });

  afterEach(async () => {
    process.env.DOMAIN_SERVER = previousDomain;
    await hub.close();
  });

  it('registers a public client with PKCE, resource and the per-server callback', async () => {
    const { authorizationUrl } = await MCPOAuthHandler.initiateOAuthFlow(
      'etus',
      `${hub.origin}/mcp`,
      'user-ana',
      {},
      undefined,
      null,
    );

    expect(hub.registrations).toHaveLength(1);
    expect(hub.registrations[0]).toMatchObject({
      client_name: 'LibreChat MCP Client',
      redirect_uris: ['https://chat.etus.test/api/mcp/etus/oauth/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp mcp:read',
    });

    const url = new URL(authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${hub.origin}/oauth/authorize`);
    expect(url.searchParams.get('client_id')).toBe('mcp_spike1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://chat.etus.test/api/mcp/etus/oauth/callback',
    );
    expect(url.searchParams.get('resource')).toBe(`${hub.origin}/mcp`);
    expect(url.searchParams.get('scope')).toBe('mcp mcp:read');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('registers again for every person: registration is not shared across users', async () => {
    await MCPOAuthHandler.initiateOAuthFlow(
      'etus',
      `${hub.origin}/mcp`,
      'user-ana',
      {},
      undefined,
      null,
    );
    await MCPOAuthHandler.initiateOAuthFlow(
      'etus',
      `${hub.origin}/mcp`,
      'user-bruno',
      {},
      undefined,
      null,
    );
    expect(hub.registrations).toHaveLength(2);
  });

  it('accepts a configured client_id (a metadata document URL) and a fixed scope without registering', async () => {
    const clientId = 'https://chat.etus.test/.well-known/mcp-client.json';
    const { authorizationUrl } = await MCPOAuthHandler.initiateOAuthFlow(
      'etus',
      `${hub.origin}/mcp`,
      'user-ana',
      {},
      { client_id: clientId, scope: 'mcp' },
      null,
    );

    expect(hub.registrations).toHaveLength(0);
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(url.searchParams.get('scope')).toBe('mcp');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe(`${hub.origin}/mcp`);
  });
});
