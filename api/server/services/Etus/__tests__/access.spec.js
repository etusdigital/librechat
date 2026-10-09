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
jest.mock('~/models', () => ({}));

const { logger } = require('@librechat/data-schemas');
const { fetchUserSettings, isHubEnabled } = require('../hubClient');
const { writeUserSettings } = require('../settingsCache');
const { syncHubGroups } = require('../groups');
const { syncHubAccess, sanitizeValues } = require('../access');

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
  });

  it('keeps the last known state when the hub is down', async () => {
    fetchUserSettings.mockResolvedValue(null);
    expect(await syncHubAccess(user)).toBe(false);
    expect(syncHubGroups).not.toHaveBeenCalled();
    expect(writeUserSettings).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws into the login flow', async () => {
    fetchUserSettings.mockResolvedValue({ active: true, groups: [], values: {} });
    syncHubGroups.mockRejectedValueOnce(new Error('mongo down'));
    await expect(syncHubAccess(user)).resolves.toBe(false);
  });

  it('does nothing when disabled or for users without an OpenID subject', async () => {
    isHubEnabled.mockReturnValue(false);
    expect(await syncHubAccess(user)).toBe(false);
    isHubEnabled.mockReturnValue(true);
    expect(await syncHubAccess({ _id: 'x' })).toBe(false);
    expect(fetchUserSettings).not.toHaveBeenCalled();
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
        other: 1,
      }),
    ).toEqual({ temperature: 0.5, systemPrompt: 'oi', mcpServers: ['a'], agents: 'x' });
    expect(sanitizeValues({ temperature: Number.NaN })).toEqual({});
    expect(sanitizeValues(null)).toEqual({});
  });
});
