jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../settingsCache', () => ({
  readUserModels: jest.fn(),
  writeUserModels: jest.fn(),
}));

const { logger } = require('@librechat/data-schemas');
const { readUserModels, writeUserModels } = require('../settingsCache');
const {
  isModelFilterEnabled,
  syncRouterModels,
  refreshStaleModels,
  getAllowedModels,
  resetRouterModels,
} = require('../routerModels');

const ENV_KEYS = ['ETUS_DELEGATION_KEY', 'ETUS_MODEL_FILTER', 'ETUS_ROUTER_URL'];
const originalFetch = global.fetch;
const NOW = 1_800_000_000_000;

const idTokenExpiringAt = (ms) =>
  `h.${Buffer.from(JSON.stringify({ sub: 's', exp: Math.floor(ms / 1000) })).toString('base64url')}.sig`;
const freshToken = idTokenExpiringAt(NOW + 60 * 60 * 1000);

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const modelList = (...ids) => response(200, { object: 'list', data: ids.map((id) => ({ id })) });

describe('routerModels', () => {
  beforeEach(() => {
    process.env.ETUS_DELEGATION_KEY = 'sk-delegation';
    global.fetch = jest.fn();
    jest.clearAllMocks();
    resetRouterModels();
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    global.fetch = originalFetch;
  });

  it('is enabled with a delegation key unless ETUS_MODEL_FILTER is off', () => {
    expect(isModelFilterEnabled()).toBe(true);
    process.env.ETUS_MODEL_FILTER = 'Off';
    expect(isModelFilterEnabled()).toBe(false);
    delete process.env.ETUS_MODEL_FILTER;
    delete process.env.ETUS_DELEGATION_KEY;
    expect(isModelFilterEnabled()).toBe(false);
  });

  it('stores the model ids the router lists for the person', async () => {
    process.env.ETUS_ROUTER_URL = 'https://router.example/';
    global.fetch.mockResolvedValue(modelList('rapido', 'cc/claude-sonnet-5', ''));

    expect(await syncRouterModels('u1', freshToken, NOW)).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://router.example/v1/models');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-delegation',
      'x-etus-id-token': freshToken,
    });
    expect(init.signal).toBeDefined();
    expect(writeUserModels).toHaveBeenCalledWith('u1', {
      models: ['rapido', 'cc/claude-sonnet-5'],
      fetchedAt: NOW,
    });
  });

  it('keeps the last known list when the router fails', async () => {
    global.fetch.mockResolvedValueOnce(response(503, {}));
    expect(await syncRouterModels('u1', freshToken, NOW)).toBe(false);
    global.fetch.mockResolvedValueOnce(response(200, { error: 'x' }));
    expect(await syncRouterModels('u1', freshToken, NOW)).toBe(false);
    global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await syncRouterModels('u1', freshToken, NOW)).toBe(false);
    expect(writeUserModels).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('does nothing when disabled or without a user or id token', async () => {
    expect(await syncRouterModels('u1', undefined, NOW)).toBe(false);
    expect(await syncRouterModels(undefined, freshToken, NOW)).toBe(false);
    process.env.ETUS_MODEL_FILTER = 'off';
    expect(await syncRouterModels('u1', freshToken, NOW)).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes stale lists in the background with the last current id token', async () => {
    global.fetch.mockResolvedValue(modelList('chat'));
    await syncRouterModels('stale', freshToken, NOW);
    await syncRouterModels('fresh', freshToken, NOW);
    global.fetch.mockClear();
    writeUserModels.mockClear();

    const later = NOW + 11 * 60 * 1000;
    readUserModels.mockImplementation(async (userId) => ({
      models: ['chat'],
      fetchedAt: userId === 'fresh' ? later - 60 * 1000 : NOW,
    }));
    await refreshStaleModels(later);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers['x-etus-id-token']).toBe(freshToken);
    expect(writeUserModels).toHaveBeenCalledWith('stale', { models: ['chat'], fetchedAt: later });
  });

  it('drops expired id tokens instead of calling the router with them', async () => {
    global.fetch.mockResolvedValue(modelList('chat'));
    await syncRouterModels('u1', idTokenExpiringAt(NOW + 5 * 60 * 1000), NOW);
    await syncRouterModels('u2', 'not-a-jwt', NOW);
    global.fetch.mockClear();
    readUserModels.mockResolvedValue(null);

    await refreshStaleModels(NOW + 10 * 60 * 1000);
    await refreshStaleModels(NOW + 10 * 60 * 1000);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(readUserModels).not.toHaveBeenCalled();
  });

  it('reads the cached list as a set', async () => {
    readUserModels.mockResolvedValueOnce({ models: ['a', 'b'], fetchedAt: NOW });
    expect(await getAllowedModels('u1')).toEqual(new Set(['a', 'b']));
    readUserModels.mockResolvedValueOnce(null);
    expect(await getAllowedModels('u1')).toBeNull();
  });
});
