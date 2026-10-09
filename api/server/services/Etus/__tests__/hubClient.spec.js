jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('@librechat/data-schemas');
const {
  isHubEnabled,
  fetchUserSettings,
  fetchAccessVersion,
  pushSettingsCatalog,
} = require('../hubClient');

const ENV_KEYS = ['ETUS_HUB_URL', 'ETUS_HUB_SERVICE_KEY', 'ETUS_HUB_APP_KEY'];
const originalFetch = global.fetch;

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('hubClient', () => {
  beforeEach(() => {
    process.env.ETUS_HUB_URL = 'https://hub.example/';
    process.env.ETUS_HUB_SERVICE_KEY = 'nxa_test';
    process.env.ETUS_HUB_APP_KEY = 'chat';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    global.fetch = originalFetch;
  });

  it('is a no-op without configuration', async () => {
    delete process.env.ETUS_HUB_SERVICE_KEY;
    expect(isHubEnabled()).toBe(false);
    expect(await fetchUserSettings('sub-1')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls the hub with the service key and returns the body', async () => {
    global.fetch.mockResolvedValue(response(200, { version: 3 }));
    expect(await fetchAccessVersion('org1')).toEqual({ version: 3 });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hub.example/api/v1/access/version');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer nxa_test', 'X-Org-Id': 'org1' });
    expect(init.signal).toBeDefined();
  });

  it('encodes the user and app in the settings path', async () => {
    global.fetch.mockResolvedValue(response(200, { active: true }));
    await fetchUserSettings('a/b');
    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://hub.example/api/v1/apps/chat/users/a%2Fb/settings',
    );
  });

  it('sends the catalog as json and accepts 204', async () => {
    global.fetch.mockResolvedValue(response(204));
    expect(await pushSettingsCatalog({ fields: [] })).toEqual({});
    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ fields: [] });
  });

  it('returns null and warns on an error status', async () => {
    global.fetch.mockResolvedValue(response(403, { error: 'wrong_app' }));
    expect(await fetchUserSettings('sub-1')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('returns null and warns when the hub is unreachable', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchUserSettings('sub-1')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});
