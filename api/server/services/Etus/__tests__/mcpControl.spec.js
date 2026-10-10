const { controlledMcpServers, withdrawControlledMcpServers } = require('../mcpControl');

const etus = {
  type: 'streamable-http',
  url: 'https://apps.etus.io/mcp',
  requiresOAuth: false,
  headers: { 'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}' },
};

const loaded = () => ({ mcpConfig: { github: { url: 'https://github.example/mcp' }, etus } });

describe('withdrawControlledMcpServers', () => {
  const previous = process.env.ETUS_HUB_MCP_SERVERS;

  afterEach(() => {
    process.env.ETUS_HUB_MCP_SERVERS = previous;
  });

  it('moves the listed YAML servers out of the shared mcpConfig', () => {
    process.env.ETUS_HUB_MCP_SERVERS = ' etus , missing ';
    const result = withdrawControlledMcpServers(loaded());
    expect(Object.keys(result.mcpConfig)).toEqual(['github']);
    expect(controlledMcpServers(result)).toEqual({ etus });
  });

  it('changes nothing when no server is listed or none matches', () => {
    delete process.env.ETUS_HUB_MCP_SERVERS;
    const config = loaded();
    expect(withdrawControlledMcpServers(config)).toBe(config);
    process.env.ETUS_HUB_MCP_SERVERS = 'other';
    expect(withdrawControlledMcpServers(config)).toBe(config);
    expect(controlledMcpServers(config)).toEqual({});
  });
});
