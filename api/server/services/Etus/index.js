const { logger, runAsSystem } = require('@librechat/data-schemas');
const { isHubEnabled } = require('./hubClient');
const { recentlySeenUsers } = require('./settingsCache');
const { refreshHubAccess, syncHubAccess } = require('./access');
const { applyHubDefaults } = require('./defaults');
const { pushCatalog } = require('./catalog');
const { isModelFilterEnabled, refreshStaleModels } = require('./routerModels');
const { syncHubShares } = require('./shares');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 1000;

let timer;
let running = false;

function syncIntervalMs() {
  const configured = Number(process.env.ETUS_HUB_SYNC_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(configured, MIN_INTERVAL_MS)
    : DEFAULT_INTERVAL_MS;
}

async function step(name, task) {
  try {
    await task();
  } catch (error) {
    logger.warn(`[EtusHub] ${name} sync failed: ${error?.message ?? error}`);
  }
}

async function refreshStaleUsers(intervalMs, now = Date.now()) {
  for (const seen of recentlySeenUsers(now)) {
    if (now - seen.fetchedAt < intervalMs) {
      continue;
    }
    await refreshHubAccess({ ...seen, background: true });
  }
}

const isSyncEnabled = () => isHubEnabled() || isModelFilterEnabled();

async function runHubSteps() {
  const { getAppConfig } = require('~/server/services/Config');
  const { loadModels } = require('~/server/controllers/ModelController');
  const appConfig = await getAppConfig({ baseOnly: true });
  await step('catalog', () => pushCatalog({ appConfig, loadModels }));
  await step('users', () => refreshStaleUsers(syncIntervalMs()));
  await step('shares', () => syncHubShares());
}

async function runHubSync() {
  if (running || !isSyncEnabled()) {
    return;
  }
  running = true;
  try {
    await runAsSystem(async () => {
      if (isHubEnabled()) {
        await step('hub', runHubSteps);
      }
      await step('models', () => refreshStaleModels());
    });
  } catch (error) {
    logger.warn(`[EtusHub] Sync failed: ${error?.message ?? error}`);
  } finally {
    running = false;
  }
}

function startEtusHubSync() {
  if (timer || !isSyncEnabled()) {
    return;
  }
  logger.info('[EtusHub] Hub sync enabled');
  void runHubSync();
  timer = setInterval(() => void runHubSync(), syncIntervalMs());
  timer.unref?.();
}

function stopEtusHubSync() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

module.exports = {
  applyHubDefaults,
  refreshStaleUsers,
  runHubSync,
  startEtusHubSync,
  stopEtusHubSync,
  syncHubAccess,
};
