import * as http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from 'jose';
import type { JWTPayload, KeyLike } from 'jose';
import { getFreePort, trackSockets } from '~/mcp/__tests__/helpers/oauthTestServer';

export const CHAT_KEY = 'mcpgw_local_spike_key';
export const ISSUER = 'http://logto.local/oidc';
export const CHAT_CLIENT_ID = 'librechat-local-client';

export interface LoggedRequest {
  httpMethod: string;
  path: string;
  rpcMethods: string[];
  authorization?: string;
  idTokenRaw?: string;
  idTokenSub?: string;
  idTokenJti?: string;
  status?: number;
}

export interface Signer {
  mint: (sub: string, opts?: { expiresInSeconds?: number; jti?: string }) => Promise<string>;
  verify: (token: string) => Promise<JWTPayload>;
}

export async function createSigner(): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey as KeyLike)), kid: 'local-1', alg: 'RS256' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  return {
    mint: async (sub, opts = {}) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ email: `${sub}@etus.test`, name: sub })
        .setProtectedHeader({ alg: 'RS256', kid: 'local-1' })
        .setIssuer(ISSUER)
        .setAudience(CHAT_CLIENT_ID)
        .setSubject(sub)
        .setIssuedAt(now)
        .setJti(opts.jti ?? `${sub}-${now}-${Math.random().toString(36).slice(2, 8)}`)
        .setExpirationTime(now + (opts.expiresInSeconds ?? 3600))
        .sign(privateKey as KeyLike);
    },
    verify: async (token) =>
      (await jwtVerify(token, jwks, { issuer: ISSUER, audience: CHAT_CLIENT_ID })).payload,
  };
}

/** Tools each person may see, keyed by Logto `sub`. Anyone else sees only the hub tools. */
const TOOLS_BY_SUB: Record<string, string[]> = {
  'sub-ana': ['hub__whoami', 'tasks__list_tasks', 'recorder__send_action_item_to_tasks'],
  'sub-bruno': ['hub__whoami'],
};

export interface GatewayOptions {
  /** What a request without a valid chat key + id token gets. */
  unauthenticated?: '401' | 'empty-list';
  /** Serve RFC 9728 metadata like the hub will (spec 3.1). */
  serveProtectedResourceMetadata?: boolean;
  /** Extra tool names to expose to every authenticated person. */
  extraTools?: string[];
  /** People whose requests fail with 500, to emulate a broken upstream. */
  serverErrorFor?: string[];
  verbose?: boolean;
}

export interface Gateway {
  url: string;
  origin: string;
  log: LoggedRequest[];
  clearLog: () => void;
  close: () => Promise<void>;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function rpcMethodsOf(body: unknown): string[] {
  return [body]
    .flat()
    .filter(Boolean)
    .map((message) => (message as { method?: string }).method)
    .filter((method): method is string => typeof method === 'string');
}

function buildServer(toolNames: string[], sub: string): Server {
  const server = new Server(
    { name: 'etus-gateway-spike', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolNames.map((name) => ({
      name,
      description: `Spike tool ${name}`,
      inputSchema: { type: 'object' as const, properties: { note: { type: 'string' } } },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!toolNames.includes(request.params.name)) {
      return { isError: true, content: [{ type: 'text', text: 'tool_not_allowed' }] };
    }
    return { content: [{ type: 'text', text: `${request.params.name} called by ${sub}` }] };
  });
  return server;
}

/**
 * Minimal stand-in for the hub gateway (spec 4): stateless Streamable HTTP, POST only,
 * chat key + `X-Etus-Id-Token` validated against a local JWKS, tools filtered by `sub`.
 * Every request is logged with the headers that matter for the spike.
 */
export async function startGateway(signer: Signer, options: GatewayOptions = {}): Promise<Gateway> {
  const log: LoggedRequest[] = [];
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const idTokenHeader = req.headers['x-etus-id-token'];
    const entry: LoggedRequest = {
      httpMethod: req.method ?? '',
      path: url.pathname,
      rpcMethods: rpcMethodsOf(body),
      authorization: req.headers.authorization,
      idTokenRaw: typeof idTokenHeader === 'string' ? idTokenHeader : undefined,
    };
    log.push(entry);
    const finish = (status: number, payload?: unknown, headers: Record<string, string> = {}) => {
      entry.status = status;
      if (options.verbose) {
        console.log('[gateway]', JSON.stringify(entry));
      }
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(payload === undefined ? undefined : JSON.stringify(payload));
    };

    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      if (!options.serveProtectedResourceMetadata) {
        return finish(404, { error: 'not_found' });
      }
      return finish(200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['mcp', 'mcp:read'],
        bearer_methods_supported: ['header'],
      });
    }
    if (url.pathname !== '/mcp') {
      return finish(404, { error: 'not_found' });
    }
    if (req.method !== 'POST') {
      return finish(405, { error: 'method_not_allowed' });
    }

    let sub: string | undefined;
    if (req.headers.authorization === `Bearer ${CHAT_KEY}` && entry.idTokenRaw) {
      try {
        const claims = await signer.verify(entry.idTokenRaw);
        sub = claims.sub;
        entry.idTokenSub = claims.sub;
        entry.idTokenJti = claims.jti;
      } catch {
        sub = undefined;
      }
    }

    if (!sub && options.unauthenticated !== 'empty-list') {
      return finish(
        401,
        { jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null },
        {
          'www-authenticate': `Bearer resource_metadata="${resourceMetadataUrl}", scope="mcp"`,
        },
      );
    }

    if (sub && options.serverErrorFor?.includes(sub)) {
      return finish(500, { error: 'upstream_failed' });
    }

    const toolNames = sub
      ? [...(TOOLS_BY_SUB[sub] ?? ['hub__whoami']), ...(options.extraTools ?? [])]
      : [];
    const server = buildServer(toolNames, sub ?? 'nobody');
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    entry.status = 200;
    if (options.verbose) {
      console.log('[gateway]', JSON.stringify(entry));
    }
    await transport.handleRequest(req, res, body);
  });

  const destroy = trackSockets(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(port, '127.0.0.1', resolve));
  return {
    url: `${origin}/mcp`,
    origin,
    log,
    clearLog: () => {
      log.length = 0;
    },
    close: destroy,
  };
}
