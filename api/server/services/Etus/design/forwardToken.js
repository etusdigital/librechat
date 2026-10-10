const { logger } = require('@librechat/data-schemas');

const FORWARD_TOKEN_PATH = '/api/v1/mcp/forward-tokens';
const DESIGN_APP_KEY = 'design';
const HUB_TIMEOUT_MS = 5000;
const EXPIRY_MARGIN_MS = 15_000;
const MAX_REUSE_MS = 45_000;
const REFUSAL_MEMO_MS = 30_000;
const FAILURE_MEMO_MS = 5_000;
const MAX_FAILURE_MEMO_MS = 60_000;
const MAX_ENTRIES = 10_000;
const MAX_TOKEN_LENGTH = 8192;
const LOGGABLE_CODE = /^[a-z0-9_]{1,64}$/;

class DesignAccessError extends Error {
  constructor(status, code, { retryAfterSeconds } = {}) {
    super(code);
    this.name = 'DesignAccessError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const reauthRequired = () => new DesignAccessError(401, 'reauth_required');
const designNotAllowed = () => new DesignAccessError(403, 'design_not_allowed');
const hubUnavailable = (retryAfterSeconds = FAILURE_MEMO_MS / 1000) =>
  new DesignAccessError(503, 'hub_unavailable', { retryAfterSeconds });

function getHubExchangeConfig() {
  const url = process.env.ETUS_HUB_URL?.trim().replace(/\/+$/, '');
  const key = process.env.ETUS_HUB_MCP_KEY?.trim();
  return url && key ? { url, key } : null;
}

function parseRetryAfterSeconds(header) {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return FAILURE_MEMO_MS / 1000;
  }
  return Math.min(Math.ceil(seconds), MAX_FAILURE_MEMO_MS / 1000);
}

async function refusalCode(response) {
  try {
    const body = await response.json();
    const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
    return LOGGABLE_CODE.test(code ?? '') ? code : 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseIssuedToken(body, requestedAt) {
  const token = body?.token;
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    return null;
  }
  const limits = [];
  if (Number.isFinite(body.expiresIn) && body.expiresIn > 0) {
    limits.push(requestedAt + body.expiresIn * 1000);
  }
  const absolute = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
  if (Number.isFinite(absolute)) {
    limits.push(absolute);
  }
  return limits.length ? { token, expiresAt: Math.min(...limits) } : null;
}

function createForwardTokenProvider({
  getConfig = getHubExchangeConfig,
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
} = {}) {
  const tokens = new Map();
  const failures = new Map();
  const inflight = new Map();

  function remember(map, key, entry) {
    map.delete(key);
    map.set(key, entry);
    if (map.size <= MAX_ENTRIES) {
      return;
    }
    const current = now();
    for (const [storedKey, stored] of map) {
      if (stored.until <= current) {
        map.delete(storedKey);
      }
    }
    while (map.size > MAX_ENTRIES) {
      map.delete(map.keys().next().value);
    }
  }

  function memoFailure(personKey, error) {
    if (error.code === 'design_not_allowed') {
      remember(failures, personKey, { error, until: now() + REFUSAL_MEMO_MS });
    } else if (error.code === 'hub_unavailable') {
      remember(failures, personKey, { error, until: now() + error.retryAfterSeconds * 1000 });
    }
  }

  async function requestToken(idToken, requestedAt) {
    const config = getConfig();
    if (!config) {
      logger.warn('[EtusDesign] ETUS_HUB_URL or ETUS_HUB_MCP_KEY is missing');
      throw hubUnavailable();
    }
    let response;
    try {
      response = await fetchImpl(`${config.url}${FORWARD_TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.key}`,
          'X-Etus-Id-Token': idToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ appKey: DESIGN_APP_KEY }),
        redirect: 'error',
        signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
      });
    } catch (error) {
      logger.warn(`[EtusDesign] Forward token request failed: ${error?.name ?? 'Error'}`);
      throw hubUnavailable();
    }
    if (response.status === 401) {
      logger.warn('[EtusDesign] Hub refused the chat key or the id token (401)');
      throw reauthRequired();
    }
    if (response.status === 403 || response.status === 404) {
      const code = await refusalCode(response);
      logger.info(`[EtusDesign] Hub refused the forward token: ${response.status} ${code}`);
      throw designNotAllowed();
    }
    if (response.status === 429) {
      logger.warn('[EtusDesign] Hub rate limited the forward token request');
      throw hubUnavailable(parseRetryAfterSeconds(response.headers?.get?.('retry-after')));
    }
    if (!response.ok) {
      logger.warn(`[EtusDesign] Hub answered ${response.status} to the forward token request`);
      throw hubUnavailable();
    }
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const issued = parseIssuedToken(body, requestedAt);
    if (!issued) {
      logger.warn('[EtusDesign] Hub answered the forward token request with an unexpected body');
      throw hubUnavailable();
    }
    return issued;
  }

  async function issue(personKey, idToken) {
    const requestedAt = now();
    try {
      const issued = await requestToken(idToken, requestedAt);
      const current = now();
      if (issued.expiresAt <= current) {
        logger.warn('[EtusDesign] Hub issued a forward token that is already expired');
        throw hubUnavailable();
      }
      failures.delete(personKey);
      const until = Math.min(issued.expiresAt - EXPIRY_MARGIN_MS, requestedAt + MAX_REUSE_MS);
      if (until > current) {
        remember(tokens, personKey, { token: issued.token, until });
      }
      return issued.token;
    } catch (error) {
      if (error instanceof DesignAccessError) {
        memoFailure(personKey, error);
      }
      throw error;
    }
  }

  function getToken(personKey, idToken) {
    const current = now();
    const cached = tokens.get(personKey);
    if (cached && cached.until > current) {
      return Promise.resolve(cached.token);
    }
    tokens.delete(personKey);
    const failure = failures.get(personKey);
    if (failure && failure.until > current) {
      return Promise.reject(failure.error);
    }
    failures.delete(personKey);
    let pending = inflight.get(personKey);
    if (!pending) {
      pending = issue(personKey, idToken).finally(() => inflight.delete(personKey));
      inflight.set(personKey, pending);
    }
    return pending;
  }

  function invalidate(personKey) {
    tokens.delete(personKey);
  }

  function clear() {
    tokens.clear();
    failures.clear();
    inflight.clear();
  }

  return { getToken, invalidate, clear, size: () => tokens.size };
}

module.exports = {
  DESIGN_APP_KEY,
  EXPIRY_MARGIN_MS,
  FORWARD_TOKEN_PATH,
  MAX_ENTRIES,
  MAX_REUSE_MS,
  REFUSAL_MEMO_MS,
  FAILURE_MEMO_MS,
  DesignAccessError,
  createForwardTokenProvider,
  getHubExchangeConfig,
  forwardTokens: createForwardTokenProvider(),
};
