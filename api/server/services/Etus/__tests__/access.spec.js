jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../hubClient', () => ({
  isHubEnabled: jest.fn(() => true),
  fetchUserSettings: jest.fn(),
}));
jest.mock('../settingsCache', () => ({
  readUserSettings: jest.fn(),
  writeUserSettings: jest.fn(),
}));
jest.mock('../groups', () => ({
  memberKeyOf: jest.requireActual('../groups').memberKeyOf,
  syncHubGroups: jest.fn(),
}));
jest.mock('../routerModels', () => ({ syncRouterModels: jest.fn(async () => true) }));
jest.mock('../skillActivation', () => ({ syncHubSkills: jest.fn() }));
jest.mock('../design/agentAccess', () => ({ syncDesignAgents: jest.fn(async () => null) }));
jest.mock('~/models', () => ({
  getUserById: jest.fn(),
  updateUser: jest.fn(),
}));

const { logger } = require('@librechat/data-schemas');
const { fetchUserSettings, isHubEnabled } = require('../hubClient');
const { writeUserSettings } = require('../settingsCache');
const { syncHubGroups } = require('../groups');
const { syncRouterModels } = require('../routerModels');
const { syncHubSkills } = require('../skillActivation');
const { syncDesignAgents } = require('../design/agentAccess');
const db = require('~/models');
const { SystemRoles } = require('librechat-data-provider');
const { syncHubAccess, refreshDelegatedAccess, sanitizeValues, hubRoleFor } = require('../access');

const user = { _id: { toString: () => 'user-1' }, openidId: 'sub-1' };

describe('syncHubAccess', () => {
  beforeEach(() => {
    isHubEnabled.mockReturnValue(true);
  });

  it('syncs groups and caches values for an active person', async () => {
    fetchUserSettings.mockResolvedValue({
      version: 4,
      active: true,
      organization: { id: 'org1' },
      groups: [{ id: 'hub:org:org1', kind: 'company', name: 'Etus' }],
      values: { model: 'openAI::gpt-4o', prompts: ['a', 1], unknown: 'x' },
    });

    expect(await syncHubAccess(user)).toBe(true);
    expect(fetchUserSettings).toHaveBeenCalledWith('sub-1');
    expect(syncHubGroups).toHaveBeenCalledWith({ _id: 'user-1', idOnTheSource: 'user-1' }, [
      { id: 'hub:org:org1', kind: 'company', name: 'Etus' },
    ]);
    expect(writeUserSettings).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        authUserId: 'sub-1',
        memberKey: 'user-1',
        version: 4,
        organizationId: 'org1',
        values: { model: 'openAI::gpt-4o', prompts: ['a'] },
      }),
      { background: false },
    );
  });

  it('activates the hub skills with the sanitized values', async () => {
    fetchUserSettings.mockResolvedValue({
      version: 2,
      active: true,
      groups: [],
      values: { skills: ['64c000000000000000000001', 7], agents: ['agent_etus_design'] },
    });

    await syncHubAccess(user);
    expect(syncHubSkills).toHaveBeenCalledWith('user-1', {
      skills: ['64c000000000000000000001'],
      agents: ['agent_etus_design'],
    });
  });

  it('clears groups and values for an inactive person', async () => {
    fetchUserSettings.mockResolvedValue({
      version: 1,
      active: false,
      groups: [{ id: 'hub:org:x' }],
      values: { model: 'a::b' },
    });
    await syncHubAccess(user);
    expect(syncHubGroups).toHaveBeenCalledWith(expect.anything(), []);
    expect(writeUserSettings.mock.calls[0][1].values).toEqual({});
    expect(syncHubSkills).toHaveBeenCalledWith('user-1', {});
  });

  it('keeps the last known state when the hub is down', async () => {
    fetchUserSettings.mockResolvedValue(null);
    expect(await syncHubAccess(user)).toBe(false);
    expect(syncHubGroups).not.toHaveBeenCalled();
    expect(writeUserSettings).not.toHaveBeenCalled();
    expect(syncHubSkills).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws into the login flow', async () => {
    fetchUserSettings.mockResolvedValue({ active: true, groups: [], values: {} });
    syncHubGroups.mockRejectedValueOnce(new Error('mongo down'));
    await expect(syncHubAccess(user)).resolves.toBe(false);
  });

  it('refreshes the router model list with the login id token', async () => {
    fetchUserSettings.mockResolvedValue({ active: true, groups: [], values: {} });
    expect(await syncHubAccess(user, 'id.jwt')).toBe(true);
    expect(syncRouterModels).toHaveBeenCalledWith('user-1', 'id.jwt');
  });

  it('syncs the design agents with the login id token, ignoring the throttle', async () => {
    fetchUserSettings.mockResolvedValue({ active: true, groups: [], values: {} });
    await syncHubAccess(user, 'id.jwt');
    expect(syncDesignAgents).toHaveBeenCalledWith('user-1', 'id.jwt', { force: true });
  });

  it('refreshes the router model list even when the hub is disabled', async () => {
    isHubEnabled.mockReturnValue(false);
    expect(await syncHubAccess(user, 'id.jwt')).toBe(false);
    expect(syncRouterModels).toHaveBeenCalledWith('user-1', 'id.jwt');
  });

  it('does nothing when disabled or for users without an OpenID subject', async () => {
    isHubEnabled.mockReturnValue(false);
    expect(await syncHubAccess(user)).toBe(false);
    isHubEnabled.mockReturnValue(true);
    expect(await syncHubAccess({ _id: 'x' })).toBe(false);
    expect(fetchUserSettings).not.toHaveBeenCalled();
  });
});

describe('hub platform admin role', () => {
  const answerWith = (fields) => ({ version: 1, groups: [], values: {}, ...fields });

  beforeEach(() => {
    isHubEnabled.mockReturnValue(true);
  });

  it('promotes a platform admin to ADMIN and logs it', async () => {
    db.getUserById.mockResolvedValue({ role: SystemRoles.USER });
    fetchUserSettings.mockResolvedValue(answerWith({ active: true, platformAdmin: true }));

    expect(await syncHubAccess(user)).toBe(true);
    expect(db.getUserById).toHaveBeenCalledWith('user-1', 'role');
    expect(db.updateUser).toHaveBeenCalledWith('user-1', { role: SystemRoles.ADMIN });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('to ADMIN'));
  });

  it('demotes an active person who lost platform admin to USER', async () => {
    db.getUserById.mockResolvedValue({ role: SystemRoles.ADMIN });
    fetchUserSettings.mockResolvedValue(answerWith({ active: true, platformAdmin: false }));

    await syncHubAccess(user);
    expect(db.updateUser).toHaveBeenCalledWith('user-1', { role: SystemRoles.USER });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('from ADMIN to USER'));
  });

  it('leaves the role alone when it already matches', async () => {
    db.getUserById.mockResolvedValue({ role: SystemRoles.ADMIN });
    fetchUserSettings.mockResolvedValue(answerWith({ active: true, platformAdmin: true }));

    await syncHubAccess(user);
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not touch the role when the hub omits platformAdmin', async () => {
    db.getUserById.mockResolvedValue({ role: SystemRoles.ADMIN });
    fetchUserSettings.mockResolvedValue(answerWith({ active: true }));

    expect(await syncHubAccess(user)).toBe(true);
    expect(db.getUserById).not.toHaveBeenCalled();
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  it('does not touch the role when the hub is down', async () => {
    fetchUserSettings.mockResolvedValue(null);

    expect(await syncHubAccess(user)).toBe(false);
    expect(db.getUserById).not.toHaveBeenCalled();
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  it('maps the hub answer to a role', () => {
    expect(hubRoleFor({ platformAdmin: true, active: false }, SystemRoles.USER)).toBe(
      SystemRoles.ADMIN,
    );
    expect(hubRoleFor({ platformAdmin: false, active: false }, SystemRoles.ADMIN)).toBe(
      SystemRoles.ADMIN,
    );
    expect(hubRoleFor({ platformAdmin: false, active: true }, 'editor')).toBe('editor');
    expect(hubRoleFor({}, SystemRoles.ADMIN)).toBe(SystemRoles.ADMIN);
  });
});

describe('sanitizeValues', () => {
  it('keeps only known keys with valid shapes', () => {
    expect(
      sanitizeValues({
        temperature: 0.5,
        systemPrompt: 'oi',
        mcpServers: ['a'],
        agents: 'x',
        skills: ['s1', null],
        other: 1,
      }),
    ).toEqual({
      temperature: 0.5,
      systemPrompt: 'oi',
      mcpServers: ['a'],
      agents: 'x',
      skills: ['s1'],
    });
    expect(sanitizeValues({ temperature: Number.NaN })).toEqual({});
    expect(sanitizeValues(null)).toEqual({});
  });
});

describe('refreshDelegatedAccess', () => {
  it('renews the router models and the design agents with the refreshed id token', async () => {
    await refreshDelegatedAccess('user-1', 'id.jwt');
    expect(syncRouterModels).toHaveBeenCalledWith('user-1', 'id.jwt');
    expect(syncDesignAgents).toHaveBeenCalledWith('user-1', 'id.jwt');
  });
});
