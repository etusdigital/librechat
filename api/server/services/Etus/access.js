const { logger } = require('@librechat/data-schemas');
const { fetchUserSettings, isHubEnabled } = require('./hubClient');
const { readUserSettings, writeUserSettings } = require('./settingsCache');
const { memberKeyOf, syncHubGroups } = require('./groups');

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
  refreshHubAccess,
  syncHubAccess,
  getCachedHubValues,
};
