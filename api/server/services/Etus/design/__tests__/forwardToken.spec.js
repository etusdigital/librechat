jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('@librechat/data-schemas');
const {
  DesignAccessError,
  MAX_ENTRIES,
  createForwardTokenProvider,
  getHubExchangeConfig,
} = require('../forwardToken');

const HUB = { url: 'https://hub.test', key: 'nxc_test_chat_key' };
const START = Date.parse('2026-10-10T12:00:00.000Z');

const hubResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => {
    if (body === undefined) {
      throw new SyntaxError('Unexpected end of JSON input');
    }
    return body;
  },
});

let issued = 0;
const issuedToken = (clock, { ttlSeconds = 60 } = {}) => {
  issued += 1;
  return hubResponse(200, {
    token: `fwd.token.${issued}`,
    tokenType: 'Bearer',
    expiresAt: new Date(clock.now + ttlSeconds * 1000).toISOString(),
    expiresIn: ttlSeconds,
  });
};

function setup({ config = HUB } = {}) {
  const clock = { now: START };
  const fetchImpl = jest.fn(async () => issuedToken(clock));
  const provider = createForwardTokenProvider({
    getConfig: () => config,
    fetchImpl,
    now: () => clock.now,
  });
  return { clock, fetchImpl, provider };
}

const loggedText = () =>
  JSON.stringify(['debug', 'info', 'warn', 'error'].flatMap((level) => logger[level].mock.calls));

describe('forward token provider', () => {
  beforeEach(() => {
    issued = 0;
    jest.clearAllMocks();
  });

  it('asks the hub with the chat key, the id token and the design app key', async () => {
    const { provider, fetchImpl } = setup();
    await expect(provider.getToken('user-1', 'id.token.1')).resolves.toBe('fwd.token.1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://hub.test/api/v1/mcp/forward-tokens');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer nxc_test_chat_key',
      'X-Etus-Id-Token': 'id.token.1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({ appKey: 'design' });
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
  });

  it('reuses the token for at most 45 seconds per person', async () => {
    const { provider, fetchImpl, clock } = setup();
    await provider.getToken('user-1', 'id.1');
    clock.now += 44_999;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.now += 1;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps one token per person', async () => {
    const { provider, fetchImpl } = setup();
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
    await expect(provider.getToken('user-2', 'id.2')).resolves.toBe('fwd.token.2');
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
    await expect(provider.getToken('user-2', 'id.2')).resolves.toBe('fwd.token.2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers['X-Etus-Id-Token']).toBe('id.2');
  });

  it('drops the token 15 seconds before it expires when that comes first', async () => {
    const { provider, fetchImpl, clock } = setup();
    fetchImpl.mockImplementationOnce(async () => issuedToken(clock, { ttlSeconds: 30 }));
    await provider.getToken('user-1', 'id.1');
    clock.now += 14_999;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
    clock.now += 1;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.2');
  });

  it('trusts the earlier of expiresAt and expiresIn', async () => {
    const { provider, fetchImpl, clock } = setup();
    fetchImpl.mockImplementationOnce(async () =>
      hubResponse(200, {
        token: 'fwd.skewed',
        expiresAt: new Date(clock.now + 25_000).toISOString(),
        expiresIn: 60,
      }),
    );
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.skewed');
    clock.now += 9_999;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.skewed');
    clock.now += 1;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
  });

  it('uses a token with less than 15 seconds left once, without caching it', async () => {
    const { provider, fetchImpl, clock } = setup();
    fetchImpl.mockImplementationOnce(async () => issuedToken(clock, { ttlSeconds: 10 }));
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
    expect(provider.size()).toBe(0);
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('never uses a token the hub issued already expired', async () => {
    const { provider, fetchImpl, clock } = setup();
    fetchImpl.mockImplementationOnce(async () =>
      hubResponse(200, {
        token: 'fwd.expired',
        expiresAt: new Date(clock.now - 1000).toISOString(),
        expiresIn: 60,
      }),
    );
    await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
      status: 503,
      code: 'hub_unavailable',
    });
  });

  it('shares one hub call between concurrent requests of the same person', async () => {
    const { provider, fetchImpl, clock } = setup();
    let release;
    fetchImpl.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(issuedToken(clock)))),
    );
    const pending = [1, 2, 3, 4, 5].map(() => provider.getToken('user-1', 'id.1'));
    release();
    await expect(Promise.all(pending)).resolves.toEqual(Array(5).fill('fwd.token.1'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks again after invalidate', async () => {
    const { provider, fetchImpl } = setup();
    await provider.getToken('user-1', 'id.1');
    provider.invalidate('user-1');
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, { error: 'no_app_access' }],
    [403, { error: 'app_unavailable' }],
    [403, { error: 'no_active_company' }],
    [404, { error: 'app_not_found' }],
  ])(
    'maps hub %i %j to 403 design_not_allowed and remembers it for 30 seconds',
    async (status, body) => {
      const { provider, fetchImpl, clock } = setup();
      fetchImpl.mockImplementationOnce(async () => hubResponse(status, body));
      const refused = provider.getToken('user-1', 'id.1');
      await expect(refused).rejects.toBeInstanceOf(DesignAccessError);
      await expect(refused).rejects.toMatchObject({ status: 403, code: 'design_not_allowed' });
      clock.now += 29_999;
      await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
        code: 'design_not_allowed',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      clock.now += 1;
      await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(body.error));
    },
  );

  it('maps hub 401 to reauth_required without remembering it', async () => {
    const { provider, fetchImpl } = setup();
    fetchImpl.mockImplementationOnce(async () => hubResponse(401, { error: 'unauthenticated' }));
    await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
      status: 401,
      code: 'reauth_required',
    });
    await expect(provider.getToken('user-1', 'id.2')).resolves.toBe('fwd.token.1');
  });

  it.each([
    ['500', async () => hubResponse(500, { error: 'internal' })],
    ['502 without body', async () => hubResponse(502)],
    ['400', async () => hubResponse(400, { error: 'invalid_request' })],
    [
      'network error',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
    [
      'timeout',
      async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
    ],
    ['a body that is not JSON', async () => hubResponse(200)],
    ['a body without token', async () => hubResponse(200, { expiresIn: 60 })],
    ['a token with spaces', async () => hubResponse(200, { token: 'a b', expiresIn: 60 })],
    ['a body without expiry', async () => hubResponse(200, { token: 'fwd.no.expiry' })],
  ])(
    'maps %s to 503 hub_unavailable and waits 5 seconds before asking again',
    async (_name, answer) => {
      const { provider, fetchImpl, clock } = setup();
      fetchImpl.mockImplementationOnce(answer);
      await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
        status: 503,
        code: 'hub_unavailable',
      });
      clock.now += 4_999;
      await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
        code: 'hub_unavailable',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      clock.now += 1;
      await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');
    },
  );

  it('honours Retry-After from a hub 429, up to 60 seconds', async () => {
    const { provider, fetchImpl, clock } = setup();
    fetchImpl.mockImplementationOnce(async () =>
      hubResponse(429, { error: 'too_many_requests' }, { 'retry-after': '20' }),
    );
    await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
      status: 503,
      code: 'hub_unavailable',
      retryAfterSeconds: 20,
    });
    clock.now += 19_999;
    await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
      code: 'hub_unavailable',
    });
    clock.now += 1;
    await expect(provider.getToken('user-1', 'id.1')).resolves.toBe('fwd.token.1');

    fetchImpl.mockImplementationOnce(async () => hubResponse(429, {}, { 'retry-after': '900' }));
    await expect(provider.getToken('user-2', 'id.2')).rejects.toMatchObject({
      retryAfterSeconds: 60,
    });
  });

  it('refuses without calling anyone when the hub is not configured', async () => {
    const { provider, fetchImpl } = setup({ config: null });
    await expect(provider.getToken('user-1', 'id.1')).rejects.toMatchObject({
      code: 'hub_unavailable',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never logs the forward token, the id token or the chat key', async () => {
    const { provider, fetchImpl } = setup();
    await provider.getToken('user-1', 'secret.id.token');
    fetchImpl.mockImplementationOnce(async () => hubResponse(403, { error: 'no_app_access' }));
    await provider.getToken('user-2', 'secret.id.token').catch(() => {});
    fetchImpl.mockImplementationOnce(async () => hubResponse(500));
    await provider.getToken('user-3', 'secret.id.token').catch(() => {});
    fetchImpl.mockImplementationOnce(async () => hubResponse(403, { error: 'x'.repeat(500) }));
    await provider.getToken('user-4', 'secret.id.token').catch(() => {});
    const text = loggedText();
    expect(text).not.toContain('fwd.token');
    expect(text).not.toContain('secret.id.token');
    expect(text).not.toContain(HUB.key);
    expect(text).not.toContain('x'.repeat(65));
  });

  it(`keeps at most ${MAX_ENTRIES} people in memory`, async () => {
    const { provider } = setup();
    for (let index = 0; index <= MAX_ENTRIES; index += 1) {
      await provider.getToken(`user-${index}`, 'id');
    }
    expect(provider.size()).toBe(MAX_ENTRIES);
  });
});

describe('getHubExchangeConfig', () => {
  const keys = ['ETUS_HUB_URL', 'ETUS_HUB_MCP_KEY'];
  afterEach(() => keys.forEach((key) => delete process.env[key]));

  it('reads the hub URL without trailing slashes and the chat key', () => {
    process.env.ETUS_HUB_URL = ' https://apps.etus.test/ ';
    process.env.ETUS_HUB_MCP_KEY = ' nxc_key ';
    expect(getHubExchangeConfig()).toEqual({ url: 'https://apps.etus.test', key: 'nxc_key' });
  });

  it('is off when either value is missing', () => {
    process.env.ETUS_HUB_URL = 'https://apps.etus.test';
    expect(getHubExchangeConfig()).toBeNull();
    delete process.env.ETUS_HUB_URL;
    process.env.ETUS_HUB_MCP_KEY = 'nxc_key';
    expect(getHubExchangeConfig()).toBeNull();
  });
});
