jest.mock('~/models', () => ({
  upsertGroupByExternalId: jest.fn(async (id) => ({ _id: `group-${id}` })),
  bulkUpdateGroups: jest.fn(async () => ({ modifiedCount: 1 })),
}));

const db = require('~/models');
const { syncHubGroups, validHubGroups, memberKeyOf } = require('../groups');

const user = { _id: { toString: () => 'user-1' } };

describe('syncHubGroups', () => {
  it('creates hub groups, adds the person and removes them only from other hub groups', async () => {
    const ids = await syncHubGroups(user, [
      { id: 'hub:org:org1', kind: 'company', name: 'Etus' },
      { id: 'hub:profile:p1', kind: 'profile', name: 'Comercial', organizationName: 'Etus' },
      { id: 'hub:team:t1', kind: 'team', name: 'Vendas', organizationName: 'Etus' },
    ]);

    expect(ids).toEqual(['hub:org:org1', 'hub:profile:p1', 'hub:team:t1']);
    expect(db.upsertGroupByExternalId).toHaveBeenCalledWith('hub:profile:p1', 'entra', {
      name: 'Comercial',
      description: 'Tipo de acesso em Etus',
    });
    expect(db.bulkUpdateGroups).toHaveBeenNthCalledWith(
      1,
      { idOnTheSource: { $in: ids }, source: 'entra', memberIds: { $ne: 'user-1' } },
      { $addToSet: { memberIds: 'user-1' } },
    );
    expect(db.bulkUpdateGroups).toHaveBeenNthCalledWith(
      2,
      { source: 'entra', memberIds: 'user-1', idOnTheSource: { $regex: '^hub:', $nin: ids } },
      { $pullAll: { memberIds: ['user-1'] } },
    );
  });

  it('removes the person from every hub group when the hub returns none', async () => {
    await syncHubGroups(user, []);
    expect(db.upsertGroupByExternalId).not.toHaveBeenCalled();
    expect(db.bulkUpdateGroups).toHaveBeenCalledTimes(1);
    expect(db.bulkUpdateGroups.mock.calls[0][0].idOnTheSource).toEqual({
      $regex: '^hub:',
      $nin: [],
    });
  });

  it('uses idOnTheSource as the member key when present', () => {
    expect(memberKeyOf({ _id: 'x', idOnTheSource: 'oid-1' })).toBe('oid-1');
  });
});

describe('validHubGroups', () => {
  it('drops ids outside the hub namespace and duplicates', () => {
    expect(
      validHubGroups([
        { id: 'hub:org:a' },
        { id: 'hub:org:a' },
        { id: 'entra-group' },
        { id: 'hub:other:a' },
        { id: 'hub:team:bad id' },
        null,
      ]).map((group) => group.id),
    ).toEqual(['hub:org:a']);
    expect(validHubGroups(undefined)).toEqual([]);
  });
});
