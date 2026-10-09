jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('@librechat/data-schemas');
const {
  AI_ACCESS_DENIED,
  isAccessGateEnabled,
  hasRouterAccess,
  assertRouterAccess,
  withAccessDeniedRedirect,
} = require('../routerGate');

const ENV_KEYS = ['ETUS_DELEGATION_KEY', 'ETUS_ACCESS_GATE', 'ETUS_ROUTER_URL'];
const originalFetch = global.fetch;

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) {
      throw new SyntaxError('Unexpected end of JSON input');
    }
    return body;
  },
});
const noActiveKey = () => response(401, { error: { code: 'AUTH_002', message: 'no key' } });

describe('routerGate', () => {
  beforeEach(() => {
    process.env.ETUS_DELEGATION_KEY = 'sk-delegation';
    global.fetch = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    global.fetch = originalFetch;
  });

  it('allows on 200 and calls the router with the delegation key and id token', async () => {
    global.fetch.mockResolvedValue(response(200));
    expect(await hasRouterAccess('id.jwt', '[EMAIL_REDACTED]')).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://router.etus.io/v1/models');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-delegation',
      'x-etus-id-token': 'id.jwt',
    });
    expect(init.signal).toBeDefined();
  });

  it('uses ETUS_ROUTER_URL without trailing slashes', async () => {
    process.env.ETUS_ROUTER_URL = 'https://router.example/';
    global.fetch.mockResolvedValue(response(200));
    await hasRouterAccess('id.jwt');
    expect(global.fetch.mock.calls[0][0]).toBe('https://router.example/v1/models');
  });

  it('refuses on 401 with AUTH_002', async () => {
    global.fetch.mockResolvedValue(noActiveKey());
    expect(await hasRouterAccess('id.jwt', '[EMAIL_REDACTED]')).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no active key'));
  });

  it('allows and logs an error on 401 with another code', async () => {
    global.fetch.mockResolvedValue(response(401, { error: { code: 'AUTH_001' } }));
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('AUTH_001'));
  });

  it('allows and logs an error on 403, even with AUTH_002', async () => {
    global.fetch.mockResolvedValue(response(403, { error: { code: 'AUTH_002' } }));
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('403'));
  });

  it('allows and logs an error on 401 with an unparsable body', async () => {
    global.fetch.mockResolvedValue(response(401));
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('no code'));
  });

  it('omits the id token header when there is none, leaving the decision to the router', async () => {
    global.fetch.mockResolvedValue(noActiveKey());
    expect(await hasRouterAccess(undefined)).toBe(false);
    expect(global.fetch.mock.calls[0][1].headers).not.toHaveProperty('x-etus-id-token');
  });

  it('allows and warns on 5xx', async () => {
    global.fetch.mockResolvedValue(response(500));
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('500'));
  });

  it('allows and warns on timeout', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    global.fetch.mockRejectedValue(timeout);
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timeout'));
  });

  it('allows and warns when the router is unreachable', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('is disabled without a delegation key', async () => {
    delete process.env.ETUS_DELEGATION_KEY;
    expect(isAccessGateEnabled()).toBe(false);
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is disabled when ETUS_ACCESS_GATE is off', async () => {
    process.env.ETUS_ACCESS_GATE = 'OFF';
    expect(isAccessGateEnabled()).toBe(false);
    expect(await hasRouterAccess('id.jwt')).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('is enabled by default when the delegation key is set', () => {
    expect(isAccessGateEnabled()).toBe(true);
    process.env.ETUS_ACCESS_GATE = 'on';
    expect(isAccessGateEnabled()).toBe(true);
  });

  it('assertRouterAccess throws the denial code only when refused', async () => {
    global.fetch.mockResolvedValueOnce(noActiveKey()).mockResolvedValueOnce(response(200));
    await expect(assertRouterAccess('id.jwt')).rejects.toThrow(AI_ACCESS_DENIED);
    await expect(assertRouterAccess('id.jwt')).resolves.toBeUndefined();
  });

  describe('withAccessDeniedRedirect', () => {
    const run = (outcome) => {
      const passport = {
        authenticate: jest.fn((strategy, options, callback) => () => callback(...outcome)),
      };
      const callback = jest.fn();
      const res = { redirect: jest.fn() };
      withAccessDeniedRedirect(passport, 'https://chat.example').authenticate(
        'openid',
        { session: false },
        callback,
      )({}, res, jest.fn());
      return { passport, callback, res };
    };

    it('sends a refused person to the login page with the denial code', () => {
      const { callback, res } = run([null, false, { message: AI_ACCESS_DENIED }]);
      expect(res.redirect).toHaveBeenCalledWith(
        `https://chat.example/login?redirect=false&error=${AI_ACCESS_DENIED}`,
      );
      expect(callback).not.toHaveBeenCalled();
    });

    it('passes every other outcome through', () => {
      const user = { _id: 'u1' };
      const { passport, callback, res } = run([null, user, undefined]);
      expect(passport.authenticate).toHaveBeenCalledWith(
        'openid',
        { session: false },
        expect.any(Function),
      );
      expect(callback).toHaveBeenCalledWith(null, user, undefined);
      expect(res.redirect).not.toHaveBeenCalled();

      const failed = run([null, false, { message: 'Email domain not allowed' }]);
      expect(failed.callback).toHaveBeenCalledWith(null, false, {
        message: 'Email domain not allowed',
      });
    });
  });
});
