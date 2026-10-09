const db = require('~/models');

const HUB_GROUP_PREFIX = 'hub:';
const HUB_GROUP_SOURCE = 'entra';
const HUB_GROUP_PATTERN = /^hub:(org|profile|team):[A-Za-z0-9_-]+$/;

const memberKeyOf = (user) => user.idOnTheSource || user._id.toString();

function groupDescription(group) {
  if (group.kind === 'company') {
    return 'Empresa no ETUS Platforms';
  }
  const kind = group.kind === 'team' ? 'Time' : 'Tipo de acesso';
  return group.organizationName ? `${kind} em ${group.organizationName}` : kind;
}

function validHubGroups(groups) {
  const byId = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (typeof group?.id === 'string' && HUB_GROUP_PATTERN.test(group.id)) {
      byId.set(group.id, group);
    }
  }
  return [...byId.values()];
}

async function syncHubGroups(user, groups) {
  const memberKey = memberKeyOf(user);
  const hubGroups = validHubGroups(groups);
  const ids = hubGroups.map((group) => group.id);

  await Promise.all(
    hubGroups.map((group) =>
      db.upsertGroupByExternalId(group.id, HUB_GROUP_SOURCE, {
        name: String(group.name || group.id).slice(0, 200),
        description: groupDescription(group),
      }),
    ),
  );

  if (ids.length > 0) {
    await db.bulkUpdateGroups(
      { idOnTheSource: { $in: ids }, source: HUB_GROUP_SOURCE, memberIds: { $ne: memberKey } },
      { $addToSet: { memberIds: memberKey } },
    );
  }

  await db.bulkUpdateGroups(
    {
      source: HUB_GROUP_SOURCE,
      memberIds: memberKey,
      idOnTheSource: { $regex: `^${HUB_GROUP_PREFIX}`, $nin: ids },
    },
    { $pullAll: { memberIds: [memberKey] } },
  );

  return ids;
}

module.exports = {
  HUB_GROUP_PREFIX,
  HUB_GROUP_SOURCE,
  HUB_GROUP_PATTERN,
  memberKeyOf,
  groupDescription,
  validHubGroups,
  syncHubGroups,
};
