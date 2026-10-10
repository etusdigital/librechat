const { logger } = require('@librechat/data-schemas');
const { standardCache } = require('@librechat/api');

const NAMESPACE = 'ETUS_HUB_SETTINGS';
const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SEEN_WINDOW_MS = 24 * 60 * 60 * 1000;
const MODELS_TTL_MS = 12 * 60 * 60 * 1000;
const modelsKey = (userId) => `models:${userId}`;
const skillsKey = (userId) => `skills:${userId}`;

let store;
const seenUsers = new Map();

function getStore() {
  if (store == null) {
    store = standardCache(NAMESPACE, ENTRY_TTL_MS);
  }
  return store;
}

function markSeen(userId, entry, seenAt = Date.now()) {
  if (!entry?.authUserId) {
    return;
  }
  seenUsers.set(userId, {
    authUserId: entry.authUserId,
    memberKey: entry.memberKey,
    fetchedAt: entry.fetchedAt ?? 0,
    seenAt,
  });
}

async function readUserSettings(userId) {
  if (!userId) {
    return null;
  }
  try {
    const entry = await getStore().get(String(userId));
    if (entry) {
      const seen = seenUsers.get(String(userId));
      if (!seen || Date.now() - seen.seenAt > 60 * 1000) {
        markSeen(String(userId), entry);
      }
    }
    return entry ?? null;
  } catch (error) {
    logger.warn(`[EtusHub] Settings cache read failed: ${error?.message ?? error}`);
    return null;
  }
}

async function writeUserSettings(userId, entry, { background = false } = {}) {
  try {
    await getStore().set(String(userId), entry);
    const previous = seenUsers.get(String(userId));
    markSeen(String(userId), entry, background && previous ? previous.seenAt : Date.now());
  } catch (error) {
    logger.warn(`[EtusHub] Settings cache write failed: ${error?.message ?? error}`);
  }
}

async function readUserModels(userId) {
  if (!userId) {
    return null;
  }
  try {
    return (await getStore().get(modelsKey(userId))) ?? null;
  } catch (error) {
    logger.warn(`[EtusRouter] Model cache read failed: ${error?.message ?? error}`);
    return null;
  }
}

async function writeUserModels(userId, entry) {
  try {
    await getStore().set(modelsKey(userId), entry, MODELS_TTL_MS);
  } catch (error) {
    logger.warn(`[EtusRouter] Model cache write failed: ${error?.message ?? error}`);
  }
}

async function readHubSkills(userId) {
  try {
    const ids = await getStore().get(skillsKey(userId));
    return Array.isArray(ids) ? ids : [];
  } catch (error) {
    logger.warn(`[EtusHub] Skill activation cache read failed: ${error?.message ?? error}`);
    return null;
  }
}

async function writeHubSkills(userId, ids) {
  try {
    await getStore().set(skillsKey(userId), ids);
  } catch (error) {
    logger.warn(`[EtusHub] Skill activation cache write failed: ${error?.message ?? error}`);
  }
}

function recentlySeenUsers(now = Date.now()) {
  const users = [];
  for (const [userId, seen] of seenUsers) {
    if (now - seen.seenAt > SEEN_WINDOW_MS) {
      seenUsers.delete(userId);
      continue;
    }
    users.push({ userId, ...seen });
  }
  return users;
}

function resetSettingsCache() {
  store = undefined;
  seenUsers.clear();
}

module.exports = {
  readUserSettings,
  writeUserSettings,
  readUserModels,
  writeUserModels,
  readHubSkills,
  writeHubSkills,
  recentlySeenUsers,
  resetSettingsCache,
};
