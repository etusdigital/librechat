jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  runAsSystem: jest.fn((task) => task()),
}));
jest.mock('../hubClient', () => ({ isHubEnabled: jest.fn(() => true) }));
jest.mock('../settingsCache', () => ({ recentlySeenUsers: jest.fn() }));
jest.mock('../access', () => ({
  refreshHubAccess: jest.fn(async () => true),
  syncHubAccess: jest.fn(),
}));
jest.mock('../defaults', () => ({ applyHubDefaults: jest.fn() }));
jest.mock('../catalog', () => ({ pushCatalog: jest.fn() }));
jest.mock('../routerModels', () => ({
  isModelFilterEnabled: jest.fn(() => false),
  refreshStaleModels: jest.fn(),
}));
jest.mock('../shares', () => ({ syncHubShares: jest.fn() }));
jest.mock('../design/agentAccess', () => ({ refreshDesignAgents: jest.fn(async () => null) }));

const { recentlySeenUsers } = require('../settingsCache');
const { refreshHubAccess } = require('../access');
const { refreshDesignAgents } = require('../design/agentAccess');
const { refreshStaleUsers } = require('../index');

describe('refreshStaleUsers', () => {
  it('renews the hub access and the design agents of each stale person', async () => {
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    recentlySeenUsers.mockReturnValue([
      { userId: 'stale', authUserId: 'sub-1', memberKey: 'm1', fetchedAt: now - 10 * 60_000 },
      { userId: 'fresh', authUserId: 'sub-2', memberKey: 'm2', fetchedAt: now - 1000 },
    ]);
    await refreshStaleUsers(5 * 60_000, now);
    expect(refreshHubAccess).toHaveBeenCalledTimes(1);
    expect(refreshHubAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'stale', background: true }),
    );
    expect(refreshDesignAgents).toHaveBeenCalledTimes(1);
    expect(refreshDesignAgents).toHaveBeenCalledWith('stale');
  });
});
