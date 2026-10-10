jest.mock('@librechat/data-schemas', () => ({
  AppService: jest.fn(),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('@librechat/data-schemas');
const {
  controlledMcpNames,
  controlledMcpServers,
  withdrawControlledMcpServers,
} = require('../mcpControl');

const etus = {
  type: 'streamable-http',
  url: 'https://apps.etus.io/mcp',
  requiresOAuth: false,
  headers: { 'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}' },
};
const github = { url: 'https://github.example/mcp' };

const loaded = () => ({ availableTools: {}, mcpConfig: { github, etus } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('controlledMcpNames', () => {
  it('reads a comma separated list and ignores blanks', () => {
    expect([...controlledMcpNames({ ETUS_HUB_MCP_SERVERS: ' etus , ,design ' })]).toEqual([
      'etus',
      'design',
    ]);
    expect(controlledMcpNames({}).size).toBe(0);
  });
});

describe('withdrawControlledMcpServers', () => {
  it('moves the listed YAML servers out of the shared mcpConfig', () => {
    const config = loaded();
    const result = withdrawControlledMcpServers(config, { ETUS_HUB_MCP_SERVERS: 'etus' });

    expect(result.mcpConfig).toEqual({ github });
    expect(controlledMcpServers(result)).toEqual({ etus });
    expect(result.availableTools).toBe(config.availableTools);
    expect(config.mcpConfig).toEqual({ github, etus });
  });

  it('changes nothing when no server is listed', () => {
    const config = loaded();
    expect(withdrawControlledMcpServers(config, {})).toBe(config);
    expect(controlledMcpServers(config)).toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns about listed names that librechat.yaml does not define', () => {
    const config = loaded();
    expect(withdrawControlledMcpServers(config, { ETUS_HUB_MCP_SERVERS: 'other' })).toBe(config);
    expect(
      withdrawControlledMcpServers({ mcpConfig: null }, { ETUS_HUB_MCP_SERVERS: 'etus' }),
    ).toEqual({ mcpConfig: null });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[0][0]).toContain('"other"');
  });

  it('warns when a controlled server could switch to per-person OAuth', () => {
    const config = { mcpConfig: { etus: { ...etus, requiresOAuth: undefined } } };
    const result = withdrawControlledMcpServers(config, { ETUS_HUB_MCP_SERVERS: 'etus' });
    expect(result.mcpConfig).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('requiresOAuth: false'));
  });
});

describe('loadBaseConfig', () => {
  const previous = process.env.ETUS_HUB_MCP_SERVERS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ETUS_HUB_MCP_SERVERS;
    } else {
      process.env.ETUS_HUB_MCP_SERVERS = previous;
    }
  });

  it('withdraws hub-controlled servers before MCP initialization reads the base config', async () => {
    process.env.ETUS_HUB_MCP_SERVERS = 'etus';
    let loadBaseConfig;
    jest.isolateModules(() => {
      jest.doMock('~/cache/getLogStores', () => jest.fn(() => ({})));
      jest.doMock('~/server/services/start/tools', () => ({ loadAndFormatTools: () => ({}) }));
      jest.doMock('~/server/services/Config/loadCustomConfig', () =>
        jest.fn().mockResolvedValue({ mcpServers: { github, etus } }),
      );
      jest.doMock('~/server/services/Config/getCachedTools', () => ({
        setCachedTools: jest.fn(),
        invalidateCachedTools: jest.fn(),
      }));
      jest.doMock('~/models', () => ({}));
      jest.doMock('@librechat/api', () => ({
        createAppConfigService: (options) => {
          loadBaseConfig = options.loadBaseConfig;
          return {};
        },
      }));
      require('@librechat/data-schemas').AppService.mockImplementation(async ({ config }) => ({
        mcpConfig: config.mcpServers,
      }));
      require('~/server/services/Config/app');
    });

    const base = await loadBaseConfig('startup');
    expect(base.mcpConfig).toEqual({ github });
    expect(controlledMcpServers(base)).toEqual({ etus });
  });
});
