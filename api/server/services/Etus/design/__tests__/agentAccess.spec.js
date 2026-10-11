jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('~/models', () => ({ deleteAclEntries: jest.fn(), findRoleByIdentifier: jest.fn() }));
jest.mock('@librechat/api', () => ({ extractOpenIDTokenInfo: jest.fn() }));

const { extractOpenIDTokenInfo } = require('@librechat/api');
const { DesignAccessError } = require('../forwardToken');
const {
  DEFAULT_AGENT_ACCESS,
  MIN_SYNC_INTERVAL_MS,
  createAgentAccessSync,
  createFollowDesignPermission,
  parseAgentAccess,
  planAgentAccess,
  readDesignPermissions,
} = require('../agentAccess');

const CONFIG = { origin: 'http://design-service:8080', basePath: '' };
const START = Date.parse('2026-10-10T12:00:00.000Z');

const idTokenUntil = (expiresAt) =>
  [
    Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'sub-1', exp: Math.floor(expiresAt / 1000) })).toString(
      'base64url',
    ),
    'signature',
  ].join('.');

const meResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) {
      throw new SyntaxError('Unexpected end of JSON input');
    }
    return body;
  },
});

const tokensThat = (getToken) => ({ getToken: jest.fn(getToken), invalidate: jest.fn() });

describe('parseAgentAccess', () => {
  it('maps each Etus Design agent to its hub permission by default', () => {
    expect([...parseAgentAccess(undefined)]).toEqual([
      ['agent_etus_design', 'projects.use'],
      ['agent_etus_design_harness', 'harness.beta'],
    ]);
    expect(parseAgentAccess('')).toEqual(parseAgentAccess(DEFAULT_AGENT_ACCESS));
  });

  it('takes the mapping from the configuration and can be turned off', () => {
    expect([...parseAgentAccess(' agent_x : projects.use , agent_y:review.jury ')]).toEqual([
      ['agent_x', 'projects.use'],
      ['agent_y', 'review.jury'],
    ]);
    expect(parseAgentAccess('OFF').size).toBe(0);
  });

  it('ignores malformed entries and keeps the valid ones', () => {
    expect([...parseAgentAccess('agent_x,agent_y:a:b,agent z:projects.use,agent_ok:Bad')]).toEqual(
      [],
    );
    expect([...parseAgentAccess('agent_x,agent_ok:harness.beta')]).toEqual([
      ['agent_ok', 'harness.beta'],
    ]);
  });
});

describe('planAgentAccess', () => {
  const agents = [
    { resourceId: 'main', permission: 'projects.use' },
    { resourceId: 'beta', permission: 'harness.beta' },
  ];

  it('grants the agents whose permission the person holds', () => {
    expect(
      planAgentAccess({ agents, permissions: new Set(['projects.use']), entries: [] }),
    ).toEqual({ grants: ['main'], revokes: [] });
  });

  it('revokes only the entries the sync created', () => {
    const entries = [
      { _id: 'e1', resourceId: 'main', owned: true },
      { _id: 'e2', resourceId: 'beta', owned: false },
    ];
    expect(planAgentAccess({ agents, permissions: new Set(), entries })).toEqual({
      grants: [],
      revokes: [entries[0]],
    });
  });

  it('never grants over a share someone made by hand', () => {
    const entries = [{ _id: 'm', resourceId: 'main', owned: false }];
    expect(planAgentAccess({ agents, permissions: new Set(['projects.use']), entries })).toEqual({
      grants: [],
      revokes: [],
    });
  });

  it('keeps what the person still holds and drops agents no longer mapped', () => {
    const entries = [
      { _id: 'e1', resourceId: 'main', owned: true },
      { _id: 'e3', resourceId: 'removed', owned: true },
    ];
    expect(
      planAgentAccess({ agents, permissions: new Set(['projects.use']), entries }).revokes,
    ).toEqual([entries[1]]);
  });
});

describe('readDesignPermissions', () => {
  const read = (tokens, fetchImpl) =>
    readDesignPermissions({
      personKey: 'user-1',
      idToken: 'id.jwt',
      config: CONFIG,
      tokens,
      fetchImpl,
    });

  it('reads the permissions from the design-service with the forward token', async () => {
    const tokens = tokensThat(async () => 'fwd.token');
    const fetchImpl = jest.fn(async () =>
      meResponse(200, { permissions: ['projects.use', 'harness.beta', 7] }),
    );
    expect(await read(tokens, fetchImpl)).toEqual(new Set(['projects.use', 'harness.beta']));
    expect(tokens.getToken).toHaveBeenCalledWith('user-1', 'id.jwt');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://design-service:8080/v1/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer fwd.token', Accept: 'application/json' },
        redirect: 'error',
      }),
    );
  });

  it('answers no permission when the hub refuses the design app to the person', async () => {
    const tokens = tokensThat(async () => {
      throw new DesignAccessError(403, 'design_not_allowed');
    });
    const fetchImpl = jest.fn();
    expect(await read(tokens, fetchImpl)).toEqual(new Set());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers no permission when the design-service refuses the person', async () => {
    const tokens = tokensThat(async () => 'fwd.token');
    expect(await read(tokens, async () => meResponse(403, { error: 'not_a_member' }))).toEqual(
      new Set(),
    );
  });

  it('answers unknown when the hub is out or the session must be renewed', async () => {
    for (const error of [
      new DesignAccessError(503, 'hub_unavailable', { retryAfterSeconds: 5 }),
      new DesignAccessError(401, 'reauth_required'),
      new Error('boom'),
    ]) {
      const tokens = tokensThat(async () => {
        throw error;
      });
      expect(await read(tokens, jest.fn())).toBeNull();
    }
  });

  it('answers unknown when the design-service is out or answers something odd', async () => {
    const tokens = tokensThat(async () => 'fwd.token');
    const answers = [
      async () => meResponse(503, { error: 'hub_unavailable' }),
      async () => meResponse(500),
      async () => meResponse(200, { permissions: 'projects.use' }),
      async () => meResponse(200),
      async () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const answer of answers) {
      expect(await read(tokens, answer)).toBeNull();
    }
  });

  it('drops a forward token the design-service refused', async () => {
    const tokens = tokensThat(async () => 'fwd.token');
    expect(await read(tokens, async () => meResponse(401))).toBeNull();
    expect(tokens.invalidate).toHaveBeenCalledWith('user-1');
  });
});

describe('createAgentAccessSync', () => {
  function setup({ permissions = ['projects.use'], config = CONFIG, access } = {}) {
    const clock = { now: START };
    const tokens = tokensThat(async () => 'fwd.token');
    const fetchImpl = jest.fn(async () => meResponse(200, { permissions }));
    const apply = jest.fn(async () => ({ granted: 1, revoked: 0 }));
    const sync = createAgentAccessSync({
      getConfig: () => config,
      getAccess: () => access ?? parseAgentAccess(undefined),
      tokens,
      fetchImpl,
      apply,
      now: () => clock.now,
    });
    return { clock, tokens, fetchImpl, apply, sync };
  }

  it('applies what the person holds in the active company', async () => {
    const { apply, sync } = setup({ permissions: ['projects.use'] });
    await sync.syncDesignAgents('user-1', idTokenUntil(START + 3600_000));
    expect(apply).toHaveBeenCalledWith(
      'user-1',
      new Set(['projects.use']),
      parseAgentAccess(undefined),
    );
  });

  it('changes nothing while the permissions are unknown', async () => {
    const { apply, fetchImpl, sync } = setup();
    fetchImpl.mockImplementation(async () => meResponse(503, { error: 'hub_unavailable' }));
    expect(await sync.syncDesignAgents('user-1', idTokenUntil(START + 3600_000))).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('does nothing when the Design or the mapping is off, or without an id token', async () => {
    const off = setup({ config: null });
    await off.sync.syncDesignAgents('user-1', idTokenUntil(START + 3600_000));
    const empty = setup({ access: new Map() });
    await empty.sync.syncDesignAgents('user-1', idTokenUntil(START + 3600_000));
    const missing = setup();
    await missing.sync.syncDesignAgents('user-1', undefined);
    await missing.sync.syncDesignAgents(undefined, idTokenUntil(START + 3600_000));
    for (const { apply, tokens } of [off, empty, missing]) {
      expect(tokens.getToken).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
    }
  });

  it('reads at most once per interval per person unless forced', async () => {
    const { apply, clock, sync } = setup();
    const idToken = idTokenUntil(START + 3600_000);
    await sync.syncDesignAgents('user-1', idToken);
    await sync.syncDesignAgents('user-1', idToken);
    expect(apply).toHaveBeenCalledTimes(1);
    await sync.syncDesignAgents('user-1', idToken, { force: true });
    expect(apply).toHaveBeenCalledTimes(2);
    clock.now += MIN_SYNC_INTERVAL_MS;
    await sync.syncDesignAgents('user-1', idToken);
    expect(apply).toHaveBeenCalledTimes(3);
  });

  it('shares one read between concurrent triggers of the same person', async () => {
    const { apply, sync } = setup();
    const idToken = idTokenUntil(START + 3600_000);
    await Promise.all([
      sync.syncDesignAgents('user-1', idToken, { force: true }),
      sync.syncDesignAgents('user-1', idToken, { force: true }),
    ]);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('renews in the background with the last id token while it is valid', async () => {
    const { apply, clock, sync } = setup();
    expect(await sync.refreshDesignAgents('user-1')).toBeNull();
    await sync.syncDesignAgents('user-1', idTokenUntil(START + 10 * 60_000));
    clock.now += MIN_SYNC_INTERVAL_MS;
    await sync.refreshDesignAgents('user-1');
    expect(apply).toHaveBeenCalledTimes(2);
    clock.now += 10 * 60_000;
    expect(await sync.refreshDesignAgents('user-1')).toBeNull();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it('never throws to the caller', async () => {
    const { apply, sync } = setup();
    apply.mockRejectedValue(new Error('mongo down'));
    await expect(
      sync.syncDesignAgents('user-1', idTokenUntil(START + 3600_000)),
    ).resolves.toBeNull();
  });
});

describe('createFollowDesignPermission', () => {
  const user = { id: 'user-1' };

  beforeEach(() => {
    extractOpenIDTokenInfo.mockReturnValue({
      idToken: 'id.jwt',
      idTokenExpiresAt: Math.floor((START + 3600_000) / 1000),
    });
  });

  it('syncs the agents when the Design screen reads /me, then hands over to the proxy', async () => {
    const sync = jest.fn(async () => null);
    const follow = createFollowDesignPermission({ sync, now: () => START });
    const next = jest.fn();
    await follow({ method: 'GET', path: '/me', user }, {}, next);
    expect(sync).toHaveBeenCalledWith('user-1', 'id.jwt');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves every other request alone', async () => {
    const sync = jest.fn();
    const follow = createFollowDesignPermission({ sync, now: () => START });
    const next = jest.fn();
    await follow({ method: 'GET', path: '/projects', user }, {}, next);
    await follow({ method: 'POST', path: '/me', user }, {}, next);
    expect(sync).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('skips the sync without a valid id token', async () => {
    extractOpenIDTokenInfo.mockReturnValue(null);
    const sync = jest.fn();
    const next = jest.fn();
    await createFollowDesignPermission({ sync, now: () => START })(
      { method: 'GET', path: '/me', user },
      {},
      next,
    );
    expect(sync).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
