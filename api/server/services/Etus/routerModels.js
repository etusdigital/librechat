const { logger } = require('@librechat/data-schemas');
const { getRouterUrl } = require('./routerGate');
const { readUserModels, writeUserModels } = require('./settingsCache');

const REQUEST_TIMEOUT_MS = 5000;
const REFRESH_AFTER_MS = 10 * 60 * 1000;
const EXPIRY_MARGIN_MS = 30 * 1000;

const idTokens = new Map();

function getModelFilterConfig() {
  const delegationKey = process.env.ETUS_DELEGATION_KEY?.trim();
  if (!delegationKey || process.env.ETUS_MODEL_FILTER?.trim().toLowerCase() === 'off') {
    return null;
  }
  return { url: getRouterUrl(), delegationKey };
}

const isModelFilterEnabled = () => getModelFilterConfig() != null;

function idTokenExpiresAt(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

const isCurrent = (token, now) => token.expiresAt - EXPIRY_MARGIN_MS > now;

function rememberIdToken(userId, idToken, now) {
  const token = { idToken, expiresAt: idTokenExpiresAt(idToken) };
  if (isCurrent(token, now)) {
    idTokens.set(userId, token);
  }
}

async function fetchRouterModels(config, idToken) {
  const response = await fetch(`${config.url}/v1/models`, {
    headers: {
      Authorization: `Bearer ${config.delegationKey}`,
      Accept: 'application/json',
      'x-etus-id-token': idToken,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    logger.warn(`[EtusRouter] Model list answered ${response.status}`);
    return null;
  }
  const body = await response.json();
  if (!Array.isArray(body?.data)) {
    logger.warn('[EtusRouter] Model list answered without a data array');
    return null;
  }
  return body.data.map((item) => item?.id).filter((id) => typeof id === 'string' && id);
}

async function syncRouterModels(userId, idToken, now = Date.now()) {
  try {
    const config = getModelFilterConfig();
    if (!config || !userId || !idToken) {
      return false;
    }
    rememberIdToken(String(userId), idToken, now);
    const models = await fetchRouterModels(config, idToken);
    if (!models) {
      return false;
    }
    await writeUserModels(String(userId), { models, fetchedAt: now });
    return true;
  } catch (error) {
    logger.warn(`[EtusRouter] Model list sync failed: ${error?.message ?? error}`);
    return false;
  }
}

async function refreshStaleModels(now = Date.now()) {
  if (!isModelFilterEnabled()) {
    return;
  }
  for (const [userId, token] of idTokens) {
    if (!isCurrent(token, now)) {
      idTokens.delete(userId);
      continue;
    }
    const entry = await readUserModels(userId);
    if (entry && now - (entry.fetchedAt ?? 0) < REFRESH_AFTER_MS) {
      continue;
    }
    await syncRouterModels(userId, token.idToken, now);
  }
}

async function getAllowedModels(userId) {
  const entry = await readUserModels(userId);
  return Array.isArray(entry?.models) ? new Set(entry.models) : null;
}

function resetRouterModels() {
  idTokens.clear();
}

module.exports = {
  isModelFilterEnabled,
  syncRouterModels,
  refreshStaleModels,
  getAllowedModels,
  resetRouterModels,
};
