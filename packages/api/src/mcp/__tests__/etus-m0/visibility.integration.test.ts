import type * as t from '~/mcp/types';
import { MCPServersRegistry } from '~/mcp/registry/MCPServersRegistry';
import { requiresUserScopedConnection } from '~/mcp/utils';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('~/auth/domain', () => ({
  isMCPDomainAllowed: jest.fn(async () => true),
}));

jest.mock('~/mcp/registry/db/ServerConfigsDB', () => ({
  ServerConfigsDB: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(undefined),
    getAll: jest.fn().mockResolvedValue({}),
    add: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    remove: jest.fn(),
    reset: jest.fn(),
  })),
}));

const etusServer: t.MCPOptions = {
  type: 'streamable-http',
  url: 'http://127.0.0.1:9/mcp',
  requiresOAuth: false,
  headers: {
    Authorization: 'Bearer ${ETUS_MCP_GATEWAY_KEY}',
    'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}',
  },
} as t.MCPOptions;

describe('M0 spike Q4: hiding the etus server per hub group', () => {
  let registry: MCPServersRegistry;

  beforeEach(async () => {
    (MCPServersRegistry as unknown as { instance: undefined }).instance = undefined;
    MCPServersRegistry.createInstance({} as typeof import('mongoose'));
    registry = MCPServersRegistry.getInstance();
    await registry.reset();
  });

  it('a YAML server reaches every user even when the per-user mcpConfig leaves it out', async () => {
    await registry.addServer('etus', etusServer, 'CACHE');

    const forAllowed = await registry.getAllServerConfigs('user-ana', {});
    const forDenied = await registry.getAllServerConfigs('user-bruno', {});

    expect(Object.keys(forAllowed)).toContain('etus');
    expect(Object.keys(forDenied)).toContain('etus');
  });

  it('the same definition as a config-tier server reaches only the users whose mcpConfig carries it', async () => {
    const granted = await registry.ensureConfigServers({ etus: etusServer });
    const denied = await registry.ensureConfigServers({});

    const forAllowed = await registry.getAllServerConfigs('user-ana', granted);
    const forDenied = await registry.getAllServerConfigs('user-bruno', denied);

    expect(Object.keys(forAllowed)).toEqual(['etus']);
    expect(Object.keys(forDenied)).toEqual([]);
    expect(forAllowed.etus.source).toBe('config');
    expect(forAllowed.etus.requiresOAuth).toBe(false);
    expect(forAllowed.etus.inspectionFailed).toBeUndefined();
    expect(requiresUserScopedConnection(forAllowed.etus)).toBe(true);
  });
});
