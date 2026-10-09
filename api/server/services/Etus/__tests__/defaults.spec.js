jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../access', () => ({ getCachedHubValues: jest.fn() }));
jest.mock('../hubClient', () => ({ isHubEnabled: jest.fn(() => true) }));

const { logger } = require('@librechat/data-schemas');
const { getCachedHubValues } = require('../access');
const { isHubEnabled } = require('../hubClient');
const {
  HUB_SPEC_NAME,
  parseModelOption,
  applyHubValues,
  applyHubDefaults,
} = require('../defaults');

const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const baseConfig = () =>
  deepFreeze({
    modelSpecs: {
      enforce: false,
      prioritize: true,
      list: [
        {
          name: 'fast',
          label: 'Fast',
          default: true,
          preset: { endpoint: 'openAI', model: 'gpt-4o-mini' },
        },
        { name: 'deep', label: 'Deep', preset: { endpoint: 'anthropic', model: 'claude-sonnet' } },
      ],
    },
    mcpConfig: {
      github: { url: 'https://github.example/mcp' },
      jira: { url: 'https://jira.example/mcp' },
      adminOnly: { url: 'https://admin.example/mcp' },
      finance: { url: 'https://finance.example/mcp' },
    },
  });

const yamlConfig = { mcpConfig: { github: {}, jira: {} } };

describe('parseModelOption', () => {
  it('reads spec and endpoint::model options', () => {
    expect(parseModelOption('spec:deep')).toEqual({ spec: 'deep' });
    expect(parseModelOption('OpenRouter::openai/gpt-4o')).toEqual({
      endpoint: 'OpenRouter',
      model: 'openai/gpt-4o',
    });
  });

  it('rejects malformed options', () => {
    expect(parseModelOption('gpt-4o')).toBeNull();
    expect(parseModelOption('::gpt-4o')).toBeNull();
    expect(parseModelOption('openAI::')).toBeNull();
    expect(parseModelOption('spec:')).toBeNull();
    expect(parseModelOption(undefined)).toBeNull();
  });
});

describe('applyHubValues', () => {
  it('adds a default spec for an endpoint model with temperature and system prompt', () => {
    const appConfig = baseConfig();
    const result = applyHubValues(appConfig, yamlConfig, {
      model: 'openAI::gpt-4o',
      temperature: 0.3,
      systemPrompt: 'Responda em pt-BR.',
    });

    const [first, ...rest] = result.modelSpecs.list;
    expect(first).toEqual({
      name: HUB_SPEC_NAME,
      label: 'gpt-4o',
      default: true,
      preset: {
        endpoint: 'openAI',
        model: 'gpt-4o',
        temperature: 0.3,
        promptPrefix: 'Responda em pt-BR.',
      },
    });
    expect(rest.map((spec) => spec.name)).toEqual(['fast', 'deep']);
    expect(rest.every((spec) => !spec.default)).toBe(true);
    expect(appConfig.modelSpecs.list[0].default).toBe(true);
  });

  it('makes an existing spec the default in place', () => {
    const result = applyHubValues(baseConfig(), yamlConfig, { model: 'spec:deep', temperature: 1 });
    expect(result.modelSpecs.list.map((spec) => [spec.name, spec.default])).toEqual([
      ['fast', false],
      ['deep', true],
    ]);
    expect(result.modelSpecs.list[1].preset).toEqual({
      endpoint: 'anthropic',
      model: 'claude-sonnet',
      temperature: 1,
    });
  });

  it('applies temperature alone to the current default spec', () => {
    const result = applyHubValues(baseConfig(), yamlConfig, { temperature: 0 });
    expect(result.modelSpecs.list[0]).toMatchObject({ name: 'fast', default: true });
    expect(result.modelSpecs.list[0].preset.temperature).toBe(0);
  });

  it('creates modelSpecs when the deployment has none', () => {
    const result = applyHubValues({ mcpConfig: {} }, {}, { model: 'google::gemini-2.5-pro' });
    expect(result.modelSpecs).toEqual({
      enforce: false,
      prioritize: true,
      list: [expect.objectContaining({ name: HUB_SPEC_NAME, default: true })],
    });
  });

  it('ignores a stale spec option', () => {
    const appConfig = baseConfig();
    expect(applyHubValues(appConfig, yamlConfig, { model: 'spec:gone' })).toBe(appConfig);
  });

  it('removes config servers outside the allowed list but keeps yaml servers', () => {
    const appConfig = baseConfig();
    const result = applyHubValues(appConfig, yamlConfig, { mcpServers: ['finance'] });
    expect(Object.keys(result.mcpConfig)).toEqual(['github', 'jira', 'finance']);
    expect(Object.keys(appConfig.mcpConfig)).toHaveLength(4);
    expect(result.modelSpecs).toBe(appConfig.modelSpecs);
  });

  it('returns the same object when nothing applies', () => {
    const appConfig = baseConfig();
    expect(applyHubValues(appConfig, yamlConfig, {})).toBe(appConfig);
    expect(applyHubValues(appConfig, yamlConfig, null)).toBe(appConfig);
  });
});

describe('applyHubDefaults', () => {
  beforeEach(() => {
    isHubEnabled.mockReturnValue(true);
  });

  it('reads only the local cache for the user', async () => {
    getCachedHubValues.mockResolvedValue({ mcpServers: [] });
    const appConfig = baseConfig();
    const result = await applyHubDefaults({ appConfig, baseConfig: yamlConfig, userId: 'u1' });
    expect(getCachedHubValues).toHaveBeenCalledWith('u1');
    expect(Object.keys(result.mcpConfig)).toEqual(['github', 'jira']);
  });

  it('leaves the config untouched without a user, without the hub or without cache', async () => {
    const appConfig = baseConfig();
    expect(await applyHubDefaults({ appConfig, userId: undefined })).toBe(appConfig);
    getCachedHubValues.mockResolvedValue(null);
    expect(await applyHubDefaults({ appConfig, userId: 'u1' })).toBe(appConfig);
    isHubEnabled.mockReturnValue(false);
    getCachedHubValues.mockClear();
    expect(await applyHubDefaults({ appConfig, userId: 'u1' })).toBe(appConfig);
    expect(getCachedHubValues).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    getCachedHubValues.mockRejectedValue(new Error('redis down'));
    const appConfig = baseConfig();
    expect(await applyHubDefaults({ appConfig, userId: 'u1' })).toBe(appConfig);
    expect(logger.warn).toHaveBeenCalled();
  });
});
