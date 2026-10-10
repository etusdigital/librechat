import type { IUser } from '@librechat/data-schemas';
import type { ParsedServerConfig } from '~/mcp/types';
import type { FlowStateManager } from '~/flow/manager';
import type { MCPOAuthTokens } from '~/mcp/oauth';
import { MCPServerInspector } from '~/mcp/registry/MCPServerInspector';
import { MCPServersRegistry } from '~/mcp/registry/MCPServersRegistry';
import { ConnectionsRepository } from '~/mcp/ConnectionsRepository';
import { canUseAppConnection, requiresUserScopedConnection } from '~/mcp/utils';
import { formatMCPServerTools } from '~/mcp/tools';
import { MCPConnection } from '~/mcp/connection';
import { MCPManager } from '~/mcp/MCPManager';
import { CHAT_KEY, createSigner, startGateway } from './gateway.helper';
import type { Gateway, Signer } from './gateway.helper';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  getTenantId: jest.fn(() => undefined),
  tenantStorage: {
    getStore: jest.fn(() => undefined),
    run: jest.fn((_context: object, fn: () => unknown) => fn()),
  },
}));

jest.mock('~/auth', () => ({
  createSSRFSafeUndiciConnect: jest.fn(() => undefined),
  isOAuthUrlAllowed: jest.fn(() => false),
  isSSRFTarget: jest.fn(() => false),
  resolveHostnameSSRF: jest.fn(async () => false),
}));

jest.mock('~/auth/domain', () => ({
  isMCPDomainAllowed: jest.fn(async () => true),
}));

const SERVER = 'etus';
const flowManager = {} as FlowStateManager<MCPOAuthTokens | null>;

function yamlConfig(url: string, extra: Partial<ParsedServerConfig> = {}): ParsedServerConfig {
  return {
    type: 'streamable-http',
    url,
    source: 'yaml',
    initTimeout: 2000,
    headers: {
      Authorization: `Bearer ${CHAT_KEY}`,
      'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}',
    },
    ...extra,
  } as ParsedServerConfig;
}

function openIdUser(id: string, sub: string, idToken: string): IUser {
  return {
    id,
    _id: id,
    role: 'USER',
    provider: 'openid',
    openidId: sub,
    email: `${sub}@etus.test`,
    federatedTokens: {
      access_token: `opaque-access-${sub}`,
      id_token: idToken,
      refresh_token: `refresh-${sub}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  } as unknown as IUser;
}

function createManager(): MCPManager {
  const manager = new MCPManager();
  manager.appConnections = {
    has: jest.fn(async () => false),
    get: jest.fn(async () => null),
    getConnectionCount: jest.fn(() => 0),
  } as unknown as ConnectionsRepository;
  return manager;
}

function mockRegistry(config: ParsedServerConfig) {
  jest.spyOn(MCPServersRegistry, 'getInstance').mockReturnValue({
    resolveAllowlists: jest.fn(async () => ({
      allowedDomains: null,
      allowedAddresses: null,
      useSSRFProtection: false,
    })),
    getServerConfig: jest.fn(async () => config),
    isAppServerConfig: jest.fn(async () => false),
  } as unknown as MCPServersRegistry);
}

describe('M0 spike: YAML server with {{LIBRECHAT_OPENID_ID_TOKEN}}', () => {
  let signer: Signer;
  let gateway: Gateway;

  beforeAll(async () => {
    signer = await createSigner();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    MCPConnection.clearCooldown(SERVER);
    await gateway?.close();
  });

  describe('Q2: discovery without a person (boot)', () => {
    it('classifies the server as per-person and never shares one connection', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url);
      expect(requiresUserScopedConnection(config)).toBe(true);
      expect(canUseAppConnection(config)).toBe(false);
    });

    it('without requiresOAuth the boot probe finds the hub metadata and flips the server to OAuth', async () => {
      gateway = await startGateway(signer, { serveProtectedResourceMetadata: true });
      const raw = yamlConfig(gateway.url);
      delete (raw as Partial<ParsedServerConfig>).requiresOAuth;

      const inspected = await MCPServerInspector.inspect(SERVER, raw, undefined, null);

      expect(inspected.requiresOAuth).toBe(true);
      expect(inspected.toolFunctions).toBeUndefined();
      const rpc = gateway.log.flatMap((entry) => entry.rpcMethods);
      expect(rpc).not.toContain('tools/list');
      expect(gateway.log.every((entry) => entry.idTokenRaw === undefined)).toBe(true);
      expect(gateway.log.every((entry) => entry.authorization === undefined)).toBe(true);
      expect(gateway.log.map((entry) => `${entry.httpMethod} ${entry.path}`)).toEqual(
        expect.arrayContaining(['GET /.well-known/oauth-protected-resource/mcp']),
      );
    });

    it('with requiresOAuth: false the boot sends nothing at all to the gateway', async () => {
      gateway = await startGateway(signer, { serveProtectedResourceMetadata: true });
      const inspected = await MCPServerInspector.inspect(
        SERVER,
        yamlConfig(gateway.url, { requiresOAuth: false }),
        undefined,
        null,
      );

      expect(inspected.requiresOAuth).toBe(false);
      expect(inspected.toolFunctions).toBeUndefined();
      expect(gateway.log).toEqual([]);
    });

    it('with startup: false the boot also sends nothing', async () => {
      gateway = await startGateway(signer, { serveProtectedResourceMetadata: true });
      const raw = yamlConfig(gateway.url, { startup: false });
      delete (raw as Partial<ParsedServerConfig>).requiresOAuth;
      const inspected = await MCPServerInspector.inspect(SERVER, raw, undefined, null);

      expect(inspected.requiresOAuth).toBe(false);
      expect(gateway.log).toEqual([]);
    });

    it('discovery without a person sends the literal placeholder and gets nothing', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();

      const result = await manager.discoverServerTools({ serverName: SERVER, flowManager });

      expect(result.tools).toBeNull();
      expect(gateway.log.length).toBeGreaterThan(0);
      expect(
        gateway.log.every((entry) => entry.idTokenRaw === '{{LIBRECHAT_OPENID_ID_TOKEN}}'),
      ).toBe(true);
      expect(gateway.log.every((entry) => entry.status === 401)).toBe(true);
    });

    it('an empty tool list answer for an anonymous request is accepted as zero tools', async () => {
      gateway = await startGateway(signer, { unauthenticated: 'empty-list' });
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();

      const result = await manager.discoverServerTools({ serverName: SERVER, flowManager });

      expect(result.tools).toEqual([]);
    });
  });

  describe('Q1: one connection per person, header refreshed on every call', () => {
    it('lists different tools for different people, each request carrying its own id token', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();
      const ana = openIdUser('user-ana', 'sub-ana', await signer.mint('sub-ana'));
      const bruno = openIdUser('user-bruno', 'sub-bruno', await signer.mint('sub-bruno'));

      const anaTools = await manager.discoverServerTools({
        serverName: SERVER,
        user: ana,
        flowManager,
      });
      const brunoTools = await manager.discoverServerTools({
        serverName: SERVER,
        user: bruno,
        flowManager,
      });

      expect(anaTools.tools?.map((tool) => tool.name).sort()).toEqual([
        'hub__whoami',
        'recorder__send_action_item_to_tasks',
        'tasks__list_tasks',
      ]);
      expect(brunoTools.tools?.map((tool) => tool.name)).toEqual(['hub__whoami']);
      const posts = gateway.log.filter((entry) => entry.httpMethod === 'POST');
      expect(new Set(posts.map((entry) => entry.idTokenSub))).toEqual(
        new Set(['sub-ana', 'sub-bruno']),
      );
      expect(gateway.log.every((entry) => entry.authorization === `Bearer ${CHAT_KEY}`)).toBe(true);
      expect(
        gateway.log.filter((entry) => entry.httpMethod === 'GET').map((entry) => entry.status),
      ).toEqual([405, 405]);
    });

    it('keeps one cached connection per person and sends the renewed id token on the next call', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();
      const firstToken = await signer.mint('sub-ana', { jti: 'ana-first' });
      const renewedToken = await signer.mint('sub-ana', { jti: 'ana-renewed' });
      const brunoToken = await signer.mint('sub-bruno', { jti: 'bruno-first' });

      const call = (user: IUser, toolName: string) =>
        manager.callTool({
          user,
          serverName: SERVER,
          serverConfig: config,
          toolName,
          provider: 'openai',
          toolArguments: {},
          flowManager,
        });

      await call(openIdUser('user-ana', 'sub-ana', firstToken), 'tasks__list_tasks');
      await call(openIdUser('user-bruno', 'sub-bruno', brunoToken), 'hub__whoami');
      await call(openIdUser('user-ana', 'sub-ana', renewedToken), 'tasks__list_tasks');

      const initializes = gateway.log.filter((entry) => entry.rpcMethods.includes('initialize'));
      expect(initializes.map((entry) => entry.idTokenSub)).toEqual(['sub-ana', 'sub-bruno']);
      const toolCalls = gateway.log.filter((entry) => entry.rpcMethods.includes('tools/call'));
      expect(toolCalls.map((entry) => entry.idTokenJti)).toEqual([
        'ana-first',
        'bruno-first',
        'ana-renewed',
      ]);
    });

    it('refuses to call with an expired id token before anything reaches the gateway', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();
      const expired = await signer.mint('sub-ana', { expiresInSeconds: -10 });

      await expect(
        manager.callTool({
          user: openIdUser('user-ana', 'sub-ana', expired),
          serverName: SERVER,
          serverConfig: config,
          toolName: 'tasks__list_tasks',
          provider: 'openai',
          toolArguments: {},
          flowManager,
        }),
      ).rejects.toThrow(/re-authentication is required/);
      expect(gateway.log).toEqual([]);
    });

    it('a cached connection whose token expired fails the call without reaching the gateway', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();
      const valid = await signer.mint('sub-ana', { jti: 'ana-valid' });
      const expired = await signer.mint('sub-ana', { expiresInSeconds: 10 });

      const call = (idToken: string) =>
        manager.callTool({
          user: openIdUser('user-ana', 'sub-ana', idToken),
          serverName: SERVER,
          serverConfig: config,
          toolName: 'tasks__list_tasks',
          provider: 'openai',
          toolArguments: {},
          flowManager,
        });

      await call(valid);
      gateway.clearLog();
      await expect(call(expired)).rejects.toThrow(/re-authentication is required/);
      expect(gateway.log).toEqual([]);
    });
  });

  describe('Q1: a token the gateway rejects', () => {
    it('surfaces an error and does not start an OAuth flow when requiresOAuth is false', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();
      const otherIssuer = await createSigner();
      const forged = await otherIssuer.mint('sub-ana');

      await expect(
        manager.callTool({
          user: openIdUser('user-ana', 'sub-ana', forged),
          serverName: SERVER,
          serverConfig: config,
          toolName: 'tasks__list_tasks',
          provider: 'openai',
          toolArguments: {},
          flowManager,
        }),
      ).rejects.toThrow();
      expect(gateway.log.length).toBeGreaterThan(0);
      expect(gateway.log.every((entry) => entry.status === 401)).toBe(true);
    });
  });

  describe('Q1: connection failures are counted per server, not per person', () => {
    const callAs = (manager: MCPManager, config: ParsedServerConfig, user: IUser) =>
      manager.callTool({
        user,
        serverName: SERVER,
        serverConfig: config,
        toolName: 'hub__whoami',
        provider: 'openai',
        toolArguments: {},
        flowManager,
      });

    it('401 answers for other people do not block the next person', async () => {
      gateway = await startGateway(signer);
      const config = yamlConfig(gateway.url, { requiresOAuth: false, initTimeout: 500 });
      mockRegistry(config);
      const manager = createManager();
      const otherIssuer = await createSigner();

      for (const name of ['carla', 'davi', 'eva']) {
        const forged = await otherIssuer.mint(`sub-${name}`);
        await expect(
          callAs(manager, config, openIdUser(`user-${name}`, `sub-${name}`, forged)),
        ).rejects.toThrow();
      }

      const ana = openIdUser('user-ana', 'sub-ana', await signer.mint('sub-ana'));
      await expect(callAs(manager, config, ana)).resolves.toBeDefined();
    });

    it('three 5xx connection failures for other people put the server in backoff for everyone', async () => {
      gateway = await startGateway(signer, {
        serverErrorFor: ['sub-carla', 'sub-davi', 'sub-eva'],
      });
      const config = yamlConfig(gateway.url, { requiresOAuth: false, initTimeout: 500 });
      mockRegistry(config);
      const manager = createManager();

      for (const name of ['carla', 'davi', 'eva']) {
        const token = await signer.mint(`sub-${name}`);
        await expect(
          callAs(manager, config, openIdUser(`user-${name}`, `sub-${name}`, token)),
        ).rejects.toThrow();
      }
      gateway.clearLog();

      const ana = openIdUser('user-ana', 'sub-ana', await signer.mint('sub-ana'));
      await expect(callAs(manager, config, ana)).rejects.toThrow();
      expect(gateway.log).toEqual([]);
      MCPConnection.clearCooldown(SERVER);
      await expect(callAs(manager, config, ana)).resolves.toBeDefined();
    });
  });

  describe('Q3: tool names as the agent sees them', () => {
    it('suffixes _mcp_<server> and keeps the gateway prefix', async () => {
      gateway = await startGateway(signer, { extraTools: ['etus__whoami'] });
      const config = yamlConfig(gateway.url, { requiresOAuth: false });
      mockRegistry(config);
      const manager = createManager();
      const ana = openIdUser('user-ana', 'sub-ana', await signer.mint('sub-ana'));
      const { tools } = await manager.discoverServerTools({
        serverName: SERVER,
        user: ana,
        flowManager,
      });

      const catalog = formatMCPServerTools(SERVER, tools ?? []);
      const names = Object.keys(catalog).sort();
      expect(names).toEqual([
        '_whoami_mcp_etus',
        'hub__whoami_mcp_etus',
        'recorder__send_action_item_to_tasks_mcp_etus',
        'tasks__list_tasks_mcp_etus',
      ]);
      expect(catalog['_whoami_mcp_etus'].serverToolName).toBe('etus__whoami');
      expect(catalog['tasks__list_tasks_mcp_etus'].serverToolName).toBeUndefined();
    });

    it('strips a tool prefix equal to the server name', () => {
      const catalog = formatMCPServerTools('tasks', [
        { name: 'tasks__list_tasks', inputSchema: { type: 'object' } },
      ] as never);
      expect(Object.keys(catalog)).toEqual(['_list_tasks_mcp_tasks']);
    });
  });
});
