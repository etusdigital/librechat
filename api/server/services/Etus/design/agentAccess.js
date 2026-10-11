const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  AccessRoleIds,
  PrincipalModel,
  PrincipalType,
  ResourceType,
} = require('librechat-data-provider');
const { DesignAccessError, forwardTokens } = require('./forwardToken');
const { currentIdToken, getDesignProxyConfig, personKeyOf } = require('./proxy');
const db = require('~/models');

const AGENT_ACCESS_MARKER = new mongoose.Types.ObjectId('000000000000000000e7a5d8');
const DEFAULT_AGENT_ACCESS =
  'agent_etus_design:projects.use,agent_etus_design_harness:harness.beta';
const ME_TIMEOUT_MS = 5000;
const MIN_SYNC_INTERVAL_MS = 30_000;
const ID_TOKEN_MIN_REMAINING_MS = 30_000;
const MAX_REMEMBERED = 10_000;
const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PERMISSION_KEY = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const LOGGABLE_ENTRY = /^[\x20-\x7e]{0,200}$/;

function parseAgentAccess(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.toLowerCase() === 'off') {
    return new Map();
  }
  const access = new Map();
  for (const pair of (value || DEFAULT_AGENT_ACCESS).split(',')) {
    const parts = pair.split(':').map((part) => part.trim());
    const [agentId, permission] = parts;
    if (parts.length !== 2 || !AGENT_ID.test(agentId) || !PERMISSION_KEY.test(permission)) {
      const shown = LOGGABLE_ENTRY.test(pair.trim()) ? pair.trim() : '(unprintable)';
      logger.warn(`[EtusDesign] Ignoring invalid ETUS_DESIGN_AGENT_ACCESS entry: ${shown}`);
      continue;
    }
    access.set(agentId, permission);
  }
  return access;
}

const getAgentAccess = () => parseAgentAccess(process.env.ETUS_DESIGN_AGENT_ACCESS);

function idTokenExpiresAt(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function planAgentAccess({ agents, permissions, entries }) {
  const wanted = new Set(
    agents.filter((agent) => permissions.has(agent.permission)).map((agent) => agent.resourceId),
  );
  const present = new Set(entries.map((entry) => entry.resourceId));
  const grants = [...wanted].filter((resourceId) => !present.has(resourceId));
  const revokes = entries.filter((entry) => entry.owned && !wanted.has(entry.resourceId));
  return { grants, revokes };
}

async function readDesignPermissions({ personKey, idToken, config, tokens, fetchImpl }) {
  let token;
  try {
    token = await tokens.getToken(personKey, idToken);
  } catch (error) {
    if (error instanceof DesignAccessError) {
      return error.code === 'design_not_allowed' ? new Set() : null;
    }
    logger.warn(`[EtusDesign] Forward token for agent access failed: ${error?.name ?? 'Error'}`);
    return null;
  }
  let response;
  try {
    response = await fetchImpl(`${config.origin}${config.basePath}/v1/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(ME_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(`[EtusDesign] Permission read failed: ${error?.name ?? 'Error'}`);
    return null;
  }
  if (response.status === 403) {
    return new Set();
  }
  if (response.status === 401) {
    tokens.invalidate(personKey);
  }
  if (!response.ok) {
    logger.warn(`[EtusDesign] Permission read answered ${response.status}`);
    return null;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!Array.isArray(body?.permissions)) {
    logger.warn('[EtusDesign] Permission read answered without a permissions list');
    return null;
  }
  return new Set(body.permissions.filter((permission) => typeof permission === 'string'));
}

async function applyAgentAccess(userId, permissions, access = getAgentAccess()) {
  const { Agent, AclEntry } = mongoose.models;
  if (!Agent || !AclEntry || !mongoose.Types.ObjectId.isValid(userId)) {
    return null;
  }
  const principalId = new mongoose.Types.ObjectId(String(userId));
  const docs =
    access.size > 0
      ? await Agent.find({ id: { $in: [...access.keys()] } }, { _id: 1, id: 1 }).lean()
      : [];
  const agents = docs.map((doc) => ({
    resourceId: doc._id.toString(),
    permission: access.get(doc.id),
  }));
  const entries = (
    await AclEntry.find(
      {
        principalType: PrincipalType.USER,
        principalId,
        resourceType: ResourceType.AGENT,
        $or: [
          { resourceId: { $in: docs.map((doc) => doc._id) } },
          { grantedBy: AGENT_ACCESS_MARKER },
        ],
      },
      { _id: 1, resourceId: 1, grantedBy: 1 },
    ).lean()
  ).map((entry) => ({
    _id: entry._id,
    resourceId: entry.resourceId.toString(),
    owned: entry.grantedBy?.toString() === AGENT_ACCESS_MARKER.toString(),
  }));

  const { grants, revokes } = planAgentAccess({ agents, permissions, entries });
  let granted = 0;
  const role = grants.length > 0 ? await db.findRoleByIdentifier(AccessRoleIds.AGENT_VIEWER) : null;
  if (grants.length > 0 && !role) {
    logger.warn('[EtusDesign] The agent viewer role is missing; design agents were not shared');
  }
  for (const resourceId of role ? grants : []) {
    try {
      const result = await AclEntry.updateOne(
        {
          principalType: PrincipalType.USER,
          principalId,
          principalModel: PrincipalModel.USER,
          resourceType: ResourceType.AGENT,
          resourceId: new mongoose.Types.ObjectId(resourceId),
        },
        {
          $setOnInsert: {
            permBits: role.permBits,
            roleId: role._id,
            grantedBy: AGENT_ACCESS_MARKER,
            grantedAt: new Date(),
          },
        },
        { upsert: true },
      );
      granted += result.upsertedCount ?? 0;
    } catch (error) {
      logger.warn(`[EtusDesign] Could not share a design agent: ${error?.message ?? error}`);
    }
  }
  if (revokes.length > 0) {
    await db.deleteAclEntries({
      _id: { $in: revokes.map((entry) => entry._id) },
      grantedBy: AGENT_ACCESS_MARKER,
    });
  }
  return { granted, revoked: revokes.length };
}

function createAgentAccessSync({
  getConfig = getDesignProxyConfig,
  getAccess = getAgentAccess,
  tokens = forwardTokens,
  fetchImpl = (...args) => fetch(...args),
  apply = applyAgentAccess,
  now = Date.now,
} = {}) {
  const idTokens = new Map();
  const lastSynced = new Map();
  const inflight = new Map();

  function remember(map, key, value) {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_REMEMBERED) {
      map.delete(map.keys().next().value);
    }
  }

  const isCurrent = (token, at) => token.expiresAt - ID_TOKEN_MIN_REMAINING_MS > at;

  function rememberIdToken(personKey, idToken) {
    const token = { idToken, expiresAt: idTokenExpiresAt(idToken) };
    if (isCurrent(token, now())) {
      remember(idTokens, personKey, token);
    }
  }

  async function run(personKey, idToken, config, access) {
    const permissions = await readDesignPermissions({
      personKey,
      idToken,
      config,
      tokens,
      fetchImpl,
    });
    if (permissions == null) {
      return null;
    }
    const result = await apply(personKey, permissions, access);
    remember(lastSynced, personKey, now());
    if (result && (result.granted > 0 || result.revoked > 0)) {
      logger.info(
        `[EtusDesign] Design agents for user ${personKey}: ${result.granted} granted, ${result.revoked} revoked`,
      );
    }
    return result;
  }

  async function syncDesignAgents(userId, idToken, { force = false } = {}) {
    try {
      const config = getConfig();
      const access = getAccess();
      const personKey = userId == null ? '' : String(userId);
      if (!config || access.size === 0 || !personKey || typeof idToken !== 'string' || !idToken) {
        return null;
      }
      rememberIdToken(personKey, idToken);
      const last = lastSynced.get(personKey);
      if (!force && last != null && now() - last < MIN_SYNC_INTERVAL_MS) {
        return null;
      }
      let pending = inflight.get(personKey);
      if (!pending) {
        pending = run(personKey, idToken, config, access).finally(() => inflight.delete(personKey));
        inflight.set(personKey, pending);
      }
      return await pending;
    } catch (error) {
      logger.warn(`[EtusDesign] Design agent sync failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function refreshDesignAgents(userId) {
    const personKey = userId == null ? '' : String(userId);
    const token = idTokens.get(personKey);
    if (!token) {
      return Promise.resolve(null);
    }
    if (!isCurrent(token, now())) {
      idTokens.delete(personKey);
      return Promise.resolve(null);
    }
    return syncDesignAgents(personKey, token.idToken);
  }

  function clear() {
    idTokens.clear();
    lastSynced.clear();
    inflight.clear();
  }

  return { syncDesignAgents, refreshDesignAgents, clear };
}

const agentAccessSync = createAgentAccessSync();

const isPermissionRead = (req) => req.method === 'GET' && /^\/me\/?$/.test(req.path ?? '');

function createFollowDesignPermission({
  sync = agentAccessSync.syncDesignAgents,
  now = Date.now,
} = {}) {
  return async function followDesignPermission(req, _res, next) {
    if (isPermissionRead(req)) {
      const personKey = personKeyOf(req.user);
      const idToken = personKey ? currentIdToken(req.user, now()) : null;
      if (idToken) {
        await sync(personKey, idToken);
      }
    }
    next();
  };
}

module.exports = {
  AGENT_ACCESS_MARKER,
  DEFAULT_AGENT_ACCESS,
  MIN_SYNC_INTERVAL_MS,
  parseAgentAccess,
  getAgentAccess,
  planAgentAccess,
  readDesignPermissions,
  applyAgentAccess,
  createAgentAccessSync,
  createFollowDesignPermission,
  followDesignPermission: createFollowDesignPermission(),
  syncDesignAgents: agentAccessSync.syncDesignAgents,
  refreshDesignAgents: agentAccessSync.refreshDesignAgents,
  resetDesignAgents: agentAccessSync.clear,
};
