const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { AccessRoleIds, PrincipalType, ResourceType } = require('librechat-data-provider');
const { fetchAccessVersion, fetchOrganizationSettings } = require('./hubClient');
const { HUB_GROUP_PATTERN, HUB_GROUP_SOURCE, groupDescription } = require('./groups');
const { grantPermission } = require('~/server/services/PermissionService');
const db = require('~/models');

const SYNC_MARKER = new mongoose.Types.ObjectId('000000000000000000e7a5e0');

const SHARED_RESOURCES = [
  {
    key: 'prompts',
    resourceType: ResourceType.PROMPTGROUP,
    accessRoleId: AccessRoleIds.PROMPTGROUP_VIEWER,
    model: 'PromptGroup',
    toFilter: (ids) => ({
      _id: { $in: ids.filter((id) => mongoose.Types.ObjectId.isValid(id)) },
    }),
    optionOf: (doc) => doc._id.toString(),
  },
  {
    key: 'agents',
    resourceType: ResourceType.AGENT,
    accessRoleId: AccessRoleIds.AGENT_VIEWER,
    model: 'Agent',
    toFilter: (ids) => ({ id: { $in: ids } }),
    optionOf: (doc) => doc.id,
  },
  {
    key: 'mcpServers',
    resourceType: ResourceType.MCPSERVER,
    accessRoleId: AccessRoleIds.MCPSERVER_VIEWER,
    model: 'MCPServer',
    toFilter: (ids) => ({ serverName: { $in: ids } }),
    optionOf: (doc) => doc.serverName,
  },
];

const SHARED_TYPES = SHARED_RESOURCES.map((resource) => resource.resourceType);
const shareKey = ({ principalId, resourceType, resourceId }) =>
  `${principalId}|${resourceType}|${resourceId}`;

function planShareChanges({ desired, owned, manual, allowRevoke }) {
  const ownedKeys = new Set(owned.map(shareKey));
  const manualKeys = new Set(manual.map(shareKey));
  const desiredKeys = new Set();
  const grants = [];
  for (const share of desired) {
    const key = shareKey(share);
    if (desiredKeys.has(key)) {
      continue;
    }
    desiredKeys.add(key);
    if (!ownedKeys.has(key) && !manualKeys.has(key)) {
      grants.push(share);
    }
  }
  const revokes = allowRevoke ? owned.filter((entry) => !desiredKeys.has(shareKey(entry))) : [];
  return { grants, revokes };
}

const lastSeen = new Map();
let lastOrganizationCount = -1;
let lastPassComplete = false;

async function readOrganization(organizationId) {
  const version = await fetchAccessVersion(organizationId);
  if (!version) {
    return null;
  }
  const cached = lastSeen.get(organizationId);
  if (cached && cached.version === version.version) {
    return { snapshot: cached, changed: false };
  }
  const settings = await fetchOrganizationSettings(organizationId);
  if (!settings) {
    return null;
  }
  const snapshot = {
    version: version.version,
    organizationName: settings.organization?.name,
    entries: Array.isArray(settings.entries) ? settings.entries : [],
  };
  lastSeen.set(organizationId, snapshot);
  return { snapshot, changed: true };
}

async function resolveResourceIds(resource, optionIds) {
  if (optionIds.size === 0) {
    return new Map();
  }
  const Model = mongoose.models[resource.model];
  if (!Model) {
    return new Map();
  }
  const docs = await Model.find(resource.toFilter([...optionIds]), {
    _id: 1,
    id: 1,
    serverName: 1,
  }).lean();
  return new Map(docs.map((doc) => [resource.optionOf(doc), doc._id.toString()]));
}

async function desiredShares(snapshots) {
  const wanted = [];
  for (const { entries, organizationName } of snapshots) {
    for (const entry of entries) {
      if (typeof entry?.groupId !== 'string' || !HUB_GROUP_PATTERN.test(entry.groupId)) {
        continue;
      }
      const lists = SHARED_RESOURCES.map((resource) => entry.values?.[resource.key]);
      if (!lists.some((list) => Array.isArray(list) && list.length > 0)) {
        continue;
      }
      const group = await db.upsertGroupByExternalId(entry.groupId, HUB_GROUP_SOURCE, {
        name: String(entry.subject?.name || entry.groupId).slice(0, 200),
        description: groupDescription({ kind: entry.subject?.kind, organizationName }),
      });
      if (group?._id) {
        wanted.push({ principalId: group._id.toString(), values: entry.values });
      }
    }
  }

  const desired = [];
  for (const resource of SHARED_RESOURCES) {
    const optionIds = new Set(
      wanted.flatMap(({ values }) =>
        Array.isArray(values?.[resource.key]) ? values[resource.key] : [],
      ),
    );
    const resourceIds = await resolveResourceIds(resource, optionIds);
    for (const { principalId, values } of wanted) {
      for (const optionId of values?.[resource.key] ?? []) {
        const resourceId = resourceIds.get(optionId);
        if (resourceId) {
          desired.push({ principalId, resourceType: resource.resourceType, resourceId });
        }
      }
    }
  }
  return desired;
}

const asShare = (entry) => ({
  _id: entry._id,
  principalId: entry.principalId.toString(),
  resourceType: entry.resourceType,
  resourceId: entry.resourceId.toString(),
});

async function syncHubShares() {
  const { AclEntry, Group } = mongoose.models;
  const orgGroups = await Group.find(
    { source: HUB_GROUP_SOURCE, idOnTheSource: { $regex: '^hub:org:' } },
    { idOnTheSource: 1 },
  ).lean();
  const organizationIds = orgGroups.map((group) => group.idOnTheSource.slice('hub:org:'.length));
  if (organizationIds.length === 0) {
    return { grants: 0, revokes: 0 };
  }

  const snapshots = [];
  let complete = true;
  let changed = organizationIds.length !== lastOrganizationCount || !lastPassComplete;
  for (const organizationId of organizationIds) {
    const read = await readOrganization(organizationId);
    if (read) {
      snapshots.push(read.snapshot);
      changed = changed || read.changed;
    } else {
      complete = false;
    }
  }
  if (!changed) {
    return { grants: 0, revokes: 0 };
  }
  lastOrganizationCount = organizationIds.length;
  lastPassComplete = false;

  const desired = await desiredShares(snapshots);
  const owned = (
    await AclEntry.find({
      grantedBy: SYNC_MARKER,
      principalType: PrincipalType.GROUP,
      resourceType: { $in: SHARED_TYPES },
    }).lean()
  ).map(asShare);
  const principalIds = [...new Set(desired.map((share) => share.principalId))];
  const manual = principalIds.length
    ? (
        await AclEntry.find({
          principalType: PrincipalType.GROUP,
          principalId: { $in: principalIds.map((id) => new mongoose.Types.ObjectId(id)) },
          resourceType: { $in: SHARED_TYPES },
          grantedBy: { $ne: SYNC_MARKER },
        }).lean()
      ).map(asShare)
    : [];

  const { grants, revokes } = planShareChanges({ desired, owned, manual, allowRevoke: complete });
  for (const share of grants) {
    const resource = SHARED_RESOURCES.find((item) => item.resourceType === share.resourceType);
    try {
      await grantPermission({
        principalType: PrincipalType.GROUP,
        principalId: share.principalId,
        resourceType: share.resourceType,
        resourceId: share.resourceId,
        accessRoleId: resource.accessRoleId,
        grantedBy: SYNC_MARKER,
      });
    } catch (error) {
      complete = false;
      logger.warn(`[EtusHub] Could not share ${share.resourceType}: ${error?.message ?? error}`);
    }
  }
  if (revokes.length > 0) {
    await db.deleteAclEntries({ _id: { $in: revokes.map((entry) => entry._id) } });
    if (revokes.some((entry) => entry.resourceType === ResourceType.PROMPTGROUP)) {
      await db.invalidatePromptGroupAccessContext();
    }
  }
  if (!complete) {
    logger.warn('[EtusHub] Share sync incomplete; it will run again on the next tick');
  }
  lastPassComplete = complete;
  return { grants: grants.length, revokes: revokes.length };
}

function resetShareState() {
  lastSeen.clear();
  lastOrganizationCount = -1;
  lastPassComplete = false;
}

module.exports = {
  SYNC_MARKER,
  planShareChanges,
  syncHubShares,
  resetShareState,
};
