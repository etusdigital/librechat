const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mongoose = require('mongoose');
const { MCPServersSchema } = require('librechat-data-provider');
const {
  processMCPEnv,
  MCPServersRegistry,
  requiresUserScopedConnection,
} = require('@librechat/api');
const { startMemoryDb, createUser } = require('../test-utils');

const EXAMPLE_FILE = path.resolve(__dirname, '..', 'mcp.example.yaml');
const LOCAL_GATEWAY = 'http://127.0.0.1:9/mcp';

const emailOf = (name) => [name, 'etus.test'].join(String.fromCharCode(64));

const readExample = () => yaml.load(fs.readFileSync(EXAMPLE_FILE, 'utf8'));

const idToken = (expiresInSeconds) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${encode({ alg: 'RS256' })}.${encode({ sub: 'sub-ana', exp })}.signature`;
};

describe('config/etus/mcp.example.yaml', () => {
  it('is a valid mcpServers block', () => {
    const result = MCPServersSchema.safeParse(readExample().mcpServers);
    expect(result.success).toBe(true);
  });

  it('follows the M0 rules for the hub gateway', () => {
    const { etus } = readExample().mcpServers;
    expect(etus).toMatchObject({
      type: 'streamable-http',
      url: 'https://apps.etus.io/mcp',
      requiresOAuth: false,
      headers: {
        Authorization: 'Bearer ${ETUS_HUB_MCP_KEY}',
        'X-Etus-Id-Token': '{{LIBRECHAT_OPENID_ID_TOKEN}}',
      },
    });
    expect(etus.initTimeout).toBeLessThanOrEqual(15000);
    expect(etus.requestHeaders).toBeUndefined();
    expect(JSON.stringify(etus)).not.toContain('LIBRECHAT_BODY');
  });
});

describe('hub-controlled etus server end to end', () => {
  const previousEnv = { ...process.env };
  let env;
  let registry;
  let withdrawControlledMcpServers;
  let applyHubValues;
  let ana;
  let bruno;

  const deployment = () => {
    const servers = MCPServersSchema.parse(readExample().mcpServers);
    servers.etus = { ...servers.etus, url: LOCAL_GATEWAY };
    return withdrawControlledMcpServers({ mcpConfig: servers });
  };

  const serversFor = async (base, mcpServers) => {
    const person = applyHubValues(base, base, { mcpServers });
    const configServers = await registry.ensureConfigServers(person.mcpConfig ?? {});
    const userId = mcpServers.length > 0 ? ana : bruno;
    return registry.getAllServerConfigs(userId, configServers);
  };

  beforeAll(async () => {
    process.env.ETUS_HUB_MCP_SERVERS = 'etus';
    process.env.ETUS_HUB_MCP_KEY = 'chat-key-for-tests';
    env = await startMemoryDb();
    ({ withdrawControlledMcpServers } = require('~/server/services/Etus/mcpControl'));
    ({ applyHubValues } = require('~/server/services/Etus/defaults'));
    registry = MCPServersRegistry.createInstance(mongoose, ['127.0.0.1']);
    ana = (await createUser(env.models, emailOf('ana'), { role: 'USER' }))._id.toString();
    bruno = (await createUser(env.models, emailOf('bruno'), { role: 'USER' }))._id.toString();
  });

  beforeEach(async () => {
    await registry.reset();
  });

  afterAll(async () => {
    process.env = previousEnv;
    await env.stop();
  });

  it('leaves the YAML tier and reaches only the people the hub granted it to', async () => {
    const base = deployment();
    expect(base.mcpConfig).toEqual({});

    const granted = await serversFor(base, ['etus']);
    expect(Object.keys(granted)).toEqual(['etus']);
    expect(granted.etus).toMatchObject({ source: 'config', requiresOAuth: false });
    expect(granted.etus.inspectionFailed).toBeUndefined();
    expect(requiresUserScopedConnection(granted.etus)).toBe(true);

    expect(await serversFor(base, [])).toEqual({});
  });

  it('sends the chat key and the person id token, and refuses an expiring id token', async () => {
    const { etus } = await serversFor(deployment(), ['etus']);
    const token = idToken(3600);
    const user = (id_token) => ({
      id: ana,
      provider: 'openid',
      openidId: 'sub-ana',
      federatedTokens: { access_token: 'access', id_token },
    });

    const resolved = processMCPEnv({ options: etus, user: user(token) });
    expect(resolved.headers).toEqual({
      Authorization: 'Bearer chat-key-for-tests',
      'X-Etus-Id-Token': token,
    });
    expect(() => processMCPEnv({ options: etus, user: user(idToken(10)) })).toThrow(
      /re-authentication is required/,
    );
  });
});
