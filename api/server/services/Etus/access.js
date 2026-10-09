const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { fetchUserSettings, isHubEnabled } = require('./hubClient');
const { readUserSettings, writeUserSettings } = require('./settingsCache');
const { memberKeyOf, syncHubGroups } = require('./groups');
const db = require('~/models');

const SETTING_KEYS = ['model', 'temperature', 'systemPrompt', 'prompts', 'agents', 'mcpServers'];

function sanitizeValues(values) {
  const result = {};
  if (!values || typeof values !== 'object') {
    return result;
  }
  for (const key of SETTING_KEYS) {
    const value = values[key];
    if (Array.isArray(value)) {
      result[key] = value.filter((item) => typeof item === 'string');
    } else if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      result[key] = value;
    }
  }
  return result;
}

function hubRoleFor(answer, currentRole) {
  if (answer.platformAdmin === true) {
    return SystemRoles.ADMIN;
  }
  if (
    answer.platformAdmin === false &&
    answer.active === true &&
    currentRole === SystemRoles.ADMIN
  ) {
    return SystemRoles.USER;
  }
  return currentRole;
}

async function syncHubRole(userId, answer) {
  if (typeof answer.platformAdmin !== 'boolean') {
    return;
  }
  const user = await db.getUserById(userId, 'role');
  if (!user) {
    return;
  }
  const role = hubRoleFor(answer, user.role);
  if (role === user.role) {
    return;
  }
  await db.updateUser(userId, { role });
  logger.info(
    `[EtusHub] User ${userId} role changed from ${user.role ?? 'none'} to ${role} (platformAdmin: ${answer.platformAdmin})`,
  );
}

async function applyHubAnswer({ userId, memberKey, authUserId, answer, background }) {
  const active = answer.active === true;
  const groups = active ? answer.groups : [];
  await syncHubGroups({ _id: userId, idOnTheSource: memberKey }, groups);
  await writeUserSettings(
    userId,
    {
      authUserId,
      memberKey,
      version: answer.version ?? null,
      organizationId: answer.organization?.id ?? null,
      values: active ? sanitizeValues(answer.values) : {},
      fetchedAt: Date.now(),
    },
    { background },
  );
  await syncHubRole(userId, answer);
}

async function refreshHubAccess({ userId, memberKey, authUserId, background = false }) {
  if (!isHubEnabled() || !authUserId || !memberKey) {
    return false;
  }
  const answer = await fetchUserSettings(authUserId);
  if (!answer) {
    logger.warn(`[EtusHub] Hub unavailable for user ${userId}; keeping last known groups`);
    return false;
  }
  await applyHubAnswer({ userId: String(userId), memberKey, authUserId, answer, background });
  return true;
}

async function syncHubAccess(user) {
  try {
    if (!isHubEnabled() || !user?._id || !user.openidId) {
      return false;
    }
    return await refreshHubAccess({
      userId: user._id.toString(),
      memberKey: memberKeyOf(user),
      authUserId: user.openidId,
    });
  } catch (error) {
    logger.warn(`[EtusHub] Access sync failed: ${error?.message ?? error}`);
    return false;
  }
}

async function getCachedHubValues(userId) {
  const entry = await readUserSettings(userId);
  return entry?.values ?? null;
}

module.exports = {
  sanitizeValues,
  hubRoleFor,
  refreshHubAccess,
  syncHubAccess,
  getCachedHubValues,
};
