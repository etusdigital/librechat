const { logger } = require('@librechat/data-schemas');

const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_ROUTER_URL = 'https://router.etus.io';
const AI_ACCESS_DENIED = 'etus_no_ai_access';
const NO_ACTIVE_KEY_CODE = 'AUTH_002';

function getGateConfig() {
  const delegationKey = process.env.ETUS_DELEGATION_KEY?.trim();
  if (!delegationKey || process.env.ETUS_ACCESS_GATE?.trim().toLowerCase() === 'off') {
    return null;
  }
  const url = (process.env.ETUS_ROUTER_URL?.trim() || DEFAULT_ROUTER_URL).replace(/\/+$/, '');
  return { url, delegationKey };
}

const isAccessGateEnabled = () => getGateConfig() != null;

async function readErrorCode(response) {
  try {
    const body = await response.json();
    return typeof body?.error?.code === 'string' ? body.error.code : null;
  } catch {
    return null;
  }
}

async function hasRouterAccess(idToken, identifier = 'unknown') {
  const config = getGateConfig();
  if (!config) {
    return true;
  }
  const headers = { Authorization: `Bearer ${config.delegationKey}`, Accept: 'application/json' };
  if (idToken) {
    headers['x-etus-id-token'] = idToken;
  }
  try {
    const response = await fetch(`${config.url}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      const code = await readErrorCode(response);
      if (response.status === 401 && code === NO_ACTIVE_KEY_CODE) {
        logger.warn(`[EtusRouter] Login refused, no active key [Identifier: ${identifier}]`);
        return false;
      }
      logger.error(
        `[EtusRouter] Router answered ${response.status} (${code ?? 'no code'}); check ETUS_DELEGATION_KEY. Allowing login [Identifier: ${identifier}]`,
      );
      return true;
    }
    if (!response.ok) {
      logger.warn(
        `[EtusRouter] Router answered ${response.status}; allowing login [Identifier: ${identifier}]`,
      );
    }
    return true;
  } catch (error) {
    logger.warn(
      `[EtusRouter] Router check failed: ${error?.message ?? error}; allowing login [Identifier: ${identifier}]`,
    );
    return true;
  }
}

async function assertRouterAccess(idToken, identifier) {
  if (!(await hasRouterAccess(idToken, identifier))) {
    throw new Error(AI_ACCESS_DENIED);
  }
}

function withAccessDeniedRedirect(passport, clientDomain) {
  return {
    authenticate: (strategy, options, callback) => (req, res, next) =>
      passport.authenticate(strategy, options, (err, user, info) => {
        if (!err && !user && info?.message === AI_ACCESS_DENIED) {
          return res.redirect(`${clientDomain}/login?redirect=false&error=${AI_ACCESS_DENIED}`);
        }
        return callback(err, user, info);
      })(req, res, next),
  };
}

module.exports = {
  AI_ACCESS_DENIED,
  isAccessGateEnabled,
  hasRouterAccess,
  assertRouterAccess,
  withAccessDeniedRedirect,
};
