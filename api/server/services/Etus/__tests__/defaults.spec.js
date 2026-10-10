jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../access', () => ({ getCachedHubValues: jest.fn() }));
jest.mock('../hubClient', () => ({ isHubEnabled: jest.fn(() => true) }));
jest.mock('../routerModels', () => ({
  isModelFilterEnabled: jest.fn(() => false),
  getAllowedModels: jest.fn(),
}));

const { logger } = require('@librechat/data-schemas');
const { getCachedHubValues } = require('../access');
const { isHubEnabled } = require('../hubClient');
const { getAllowedModels, isModelFilterEnabled } = require('../routerModels');
const {
  HUB_SPEC_NAME,
  ROUTER_ENDPOINT,
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

const routerSpec = (name, model, extra = {}) => ({
  name,
  label: name,
  preset: { endpoint: ROUTER_ENDPOINT, model },
  ...extra,
});

const routerConfig = () =>
  deepFreeze({
    modelSpecs: {
      enforce: false,
      prioritize: true,
      addedEndpoints: ['agents'],
      list: [
        routerSpec('rapido', 'rapido'),
        routerSpec('chat', 'chat'),
        routerSpec('claude-opus-5-5', 'cc/claude-opus-5-5', { group: 'Modelos diretos' }),
        routerSpec('gpt-6-astra-high', 'cx/gpt-6-astra-high', { group: 'Modelos diretos' }),
        {
          name: 'other',
          label: 'Other',
          preset: { endpoint: 'openAI', model: 'gpt-4o' },
        },
      ],
    },
    endpoints: {
      custom: [
        {
          name: ROUTER_ENDPOINT,
          models: {
            default: ['rapido', 'chat', 'cc/claude-opus-5-5', 'cx/gpt-6-astra-high'],
            fetch: false,
          },
        },
        { name: 'Other', models: { default: ['cc/claude-opus-5-5', 'x'] } },
      ],
    },
  });

const specNames = (config) => config.modelSpecs.list.map((spec) => spec.name);
const routerModels = (config) =>
  config.endpoints.custom.find((endpoint) => endpoint.name === ROUTER_ENDPOINT).models.default;

describe('router model filter', () => {
  const allowed = new Set(['rapido', 'cc/claude-opus-5-5', 'unrelated']);

  it('keeps only the router specs and endpoint models the person can use, combos included', () => {
    const appConfig = routerConfig();
    const result = applyHubValues(appConfig, {}, null, allowed);
    expect(specNames(result)).toEqual(['rapido', 'claude-opus-5-5', 'other']);
    expect(result.modelSpecs.addedEndpoints).toEqual(['agents']);
    expect(routerModels(result)).toEqual(['rapido', 'cc/claude-opus-5-5']);
    expect(result.endpoints.custom[1].models.default).toEqual(['cc/claude-opus-5-5', 'x']);
    expect(specNames(appConfig)).toHaveLength(5);
  });

  it('matches endpoint models given as objects', () => {
    const appConfig = {
      endpoints: {
        custom: [{ name: ROUTER_ENDPOINT, models: { default: [{ name: 'rapido' }, 'chat'] } }],
      },
    };
    const result = applyHubValues(appConfig, {}, null, allowed);
    expect(routerModels(result)).toEqual([{ name: 'rapido' }]);
  });

  it('returns the same config when everything is allowed', () => {
    const appConfig = routerConfig();
    const all = new Set(routerModels(appConfig));
    expect(applyHubValues(appConfig, {}, null, all)).toBe(appConfig);
  });

  it('falls back to the first remaining spec when the hub default was filtered out', () => {
    const result = applyHubValues(
      routerConfig(),
      {},
      { model: 'spec:gpt-6-astra-high', temperature: 0.2 },
      allowed,
    );
    expect(result.modelSpecs.list.map((spec) => [spec.name, Boolean(spec.default)])).toEqual([
      ['rapido', true],
      ['claude-opus-5-5', false],
      ['other', false],
    ]);
    expect(result.modelSpecs.list[0].preset.temperature).toBe(0.2);
  });

  it('falls back when the hub default is a router model the person cannot use', () => {
    const result = applyHubValues(
      routerConfig(),
      {},
      { model: `${ROUTER_ENDPOINT}::chat` },
      allowed,
    );
    expect(specNames(result)).toEqual(['rapido', 'claude-opus-5-5', 'other']);
    expect(result.modelSpecs.list[0].default).toBe(true);
  });

  it('keeps an allowed hub default', () => {
    const viaSpec = applyHubValues(routerConfig(), {}, { model: 'spec:claude-opus-5-5' }, allowed);
    expect(viaSpec.modelSpecs.list.find((spec) => spec.default).name).toBe('claude-opus-5-5');

    const viaModel = applyHubValues(
      routerConfig(),
      {},
      { model: `${ROUTER_ENDPOINT}::rapido` },
      allowed,
    );
    expect(viaModel.modelSpecs.list[0]).toMatchObject({ name: HUB_SPEC_NAME, default: true });
  });

  it('moves the yaml default to the first remaining spec when it was filtered out', () => {
    const appConfig = routerConfig();
    const withDefault = {
      ...appConfig,
      modelSpecs: {
        ...appConfig.modelSpecs,
        list: appConfig.modelSpecs.list.map((spec) =>
          spec.name === 'chat' ? { ...spec, default: true } : spec,
        ),
      },
    };
    const result = applyHubValues(withDefault, {}, null, allowed);
    expect(result.modelSpecs.list[0]).toMatchObject({ name: 'rapido', default: true });
  });
});

describe('applyHubDefaults with the router model filter', () => {
  beforeEach(() => {
    isHubEnabled.mockReturnValue(true);
    isModelFilterEnabled.mockReturnValue(true);
    getCachedHubValues.mockResolvedValue({ model: 'spec:chat' });
    logger.warn.mockClear();
  });

  afterEach(() => {
    isModelFilterEnabled.mockReturnValue(false);
  });

  it('filters with the cached set and applies the fallback default', async () => {
    getAllowedModels.mockResolvedValue(new Set(['rapido', 'cx/gpt-6-astra-high']));
    const result = await applyHubDefaults({ appConfig: routerConfig(), userId: 'u-set' });
    expect(getAllowedModels).toHaveBeenCalledWith('u-set');
    expect(specNames(result)).toEqual(['rapido', 'gpt-6-astra-high', 'other']);
    expect(result.modelSpecs.list[0].default).toBe(true);
    expect(routerModels(result)).toEqual(['rapido', 'cx/gpt-6-astra-high']);
  });

  it('filters even without the hub', async () => {
    isHubEnabled.mockReturnValue(false);
    getAllowedModels.mockResolvedValue(new Set(['chat']));
    const result = await applyHubDefaults({ appConfig: routerConfig(), userId: 'u-nohub' });
    expect(specNames(result)).toEqual(['chat', 'other']);
  });

  it.each([
    ['unknown', null],
    ['empty', new Set()],
    ['without curated models', new Set(['unrelated'])],
  ])('fails open and logs once when the set is %s', async (_label, set) => {
    getAllowedModels.mockResolvedValue(set);
    getCachedHubValues.mockResolvedValue(null);
    const appConfig = routerConfig();
    const userId = `u-${_label}`;
    expect(await applyHubDefaults({ appConfig, userId })).toBe(appConfig);
    expect(await applyHubDefaults({ appConfig, userId })).toBe(appConfig);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('showing every curated'));
  });

  it('logs again after the set was known and became unknown', async () => {
    getCachedHubValues.mockResolvedValue(null);
    getAllowedModels.mockResolvedValueOnce(null);
    getAllowedModels.mockResolvedValueOnce(new Set(['chat']));
    getAllowedModels.mockResolvedValueOnce(null);
    for (let i = 0; i < 3; i++) {
      await applyHubDefaults({ appConfig: routerConfig(), userId: 'u-flap' });
    }
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('does not read the set when the filter is disabled', async () => {
    isModelFilterEnabled.mockReturnValue(false);
    getAllowedModels.mockClear();
    getCachedHubValues.mockResolvedValue(null);
    const appConfig = routerConfig();
    expect(await applyHubDefaults({ appConfig, userId: 'u1' })).toBe(appConfig);
    expect(getAllowedModels).not.toHaveBeenCalled();
  });
});
