const { logger } = require('@librechat/data-schemas');

const REQUEST_TIMEOUT_MS = 5000;

function getHubConfig() {
  const url = process.env.ETUS_HUB_URL?.trim().replace(/\/+$/, '');
  const serviceKey = process.env.ETUS_HUB_SERVICE_KEY?.trim();
  const appKey = process.env.ETUS_HUB_APP_KEY?.trim();
  if (!url || !serviceKey || !appKey) {
    return null;
  }
  return { url, serviceKey, appKey };
}

const isHubEnabled = () => getHubConfig() != null;

async function hubRequest(method, path, { organizationId, body } = {}) {
  const config = getHubConfig();
  if (!config) {
    return null;
  }
  const headers = { Authorization: `Bearer ${config.serviceKey}`, Accept: 'application/json' };
  if (organizationId) {
    headers['X-Org-Id'] = organizationId;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  try {
    const response = await fetch(`${config.url}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn(`[EtusHub] ${method} ${path} answered ${response.status}`);
      return null;
    }
    if (response.status === 204) {
      return {};
    }
    return await response.json();
  } catch (error) {
    logger.warn(`[EtusHub] ${method} ${path} failed: ${error?.message ?? error}`);
    return null;
  }
}

const appPath = (suffix) => `/v1/apps/${encodeURIComponent(getHubConfig()?.appKey ?? '')}${suffix}`;

const fetchUserSettings = (authUserId) =>
  hubRequest('GET', appPath(`/users/${encodeURIComponent(authUserId)}/settings`));

const fetchOrganizationSettings = (organizationId) =>
  hubRequest('GET', appPath('/settings'), { organizationId });

const fetchAccessVersion = (organizationId) =>
  hubRequest('GET', '/v1/access/version', { organizationId });

const pushSettingsCatalog = (catalog) =>
  hubRequest('PUT', appPath('/settings-catalog'), { body: catalog });

module.exports = {
  getHubConfig,
  isHubEnabled,
  fetchUserSettings,
  fetchOrganizationSettings,
  fetchAccessVersion,
  pushSettingsCatalog,
};
