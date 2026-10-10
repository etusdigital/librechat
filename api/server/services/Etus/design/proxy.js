const http = require('node:http');
const https = require('node:https');
const { Transform, pipeline } = require('node:stream');
const { logger } = require('@librechat/data-schemas');
const { extractOpenIDTokenInfo } = require('@librechat/api');
const { DesignAccessError, forwardTokens } = require('./forwardToken');

const MB = 1024 * 1024;
const DEFAULT_UPLOAD_LIMIT_MB = 25;
const MULTIPART_ALLOWANCE_BYTES = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const ID_TOKEN_MIN_REMAINING_MS = 30_000;
const MAX_ETUS_HEADER_LENGTH = 8192;

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'range',
  'user-agent',
];
const PASSTHROUGH_ETUS_HEADERS = ['x-etus-version-source', 'x-etus-note'];
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'set-cookie',
  'set-cookie2',
  'server',
  'x-powered-by',
  'www-authenticate',
]);
const PATH_SEGMENT = /^[A-Za-z0-9\-._~%!$&'()*+,;=:@]+$/;
const isForbiddenChar = (char) => {
  const code = char.charCodeAt(0);
  return char === '/' || char === '\\' || code < 0x20 || code === 0x7f;
};
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

const MESSAGES = {
  design_disabled: 'O Etus Design não está ligado neste chat.',
  not_found: 'Endereço não encontrado.',
  method_not_allowed: 'Método não aceito.',
  unsupported_media_type: 'Formato de envio não aceito.',
  invalid_header: 'Cabeçalho inválido.',
  payload_too_large: 'O envio passa do limite.',
  reauth_required: 'Sua sessão expirou. Entre de novo.',
  design_not_allowed: 'Você não tem acesso ao Etus Design. Fale com a administração do hub.',
  hub_unavailable: 'O hub está fora do ar. Tente de novo em instantes.',
  design_unavailable: 'O Etus Design está fora do ar. Tente de novo em instantes.',
  design_timeout: 'O Etus Design demorou demais para responder.',
  design_auth_failed: 'O Etus Design recusou o acesso. Tente de novo em instantes.',
};

class ProxyFailure extends Error {
  constructor(status, code, details) {
    super(code);
    this.name = 'ProxyFailure';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getDesignProxyConfig() {
  const raw = process.env.ETUS_DESIGN_URL?.trim();
  if (!raw) {
    return null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    logger.warn('[EtusDesign] ETUS_DESIGN_URL is not a valid URL');
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search) {
    logger.warn('[EtusDesign] ETUS_DESIGN_URL must be a plain http or https address');
    return null;
  }
  const uploadLimitMb = positiveInteger(
    process.env.ETUS_DESIGN_MAX_UPLOAD_MB,
    DEFAULT_UPLOAD_LIMIT_MB,
  );
  return {
    origin: url.origin,
    basePath: url.pathname.replace(/\/+$/, ''),
    uploadLimitMb,
    bodyLimitBytes: uploadLimitMb * MB + MULTIPART_ALLOWANCE_BYTES,
  };
}

function sendError(res, status, code, { retryAfterSeconds, details, closeConnection } = {}) {
  res.status(status);
  res.set('Cache-Control', 'no-store');
  if (retryAfterSeconds) {
    res.set('Retry-After', String(retryAfterSeconds));
  }
  if (closeConnection) {
    res.set('Connection', 'close');
  }
  res.json({ error: { code, message: MESSAGES[code] ?? code, ...(details && { details }) } });
}

function targetUrl(req, config) {
  const url = req.url ?? '';
  const queryStart = url.indexOf('?');
  const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart);
  if (!rawPath.startsWith('/') || rawPath === '/') {
    return null;
  }
  const segments = rawPath.slice(1).split('/');
  for (const [index, segment] of segments.entries()) {
    if (segment === '') {
      if (index > 0 && index === segments.length - 1) {
        continue;
      }
      return null;
    }
    if (!PATH_SEGMENT.test(segment)) {
      return null;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || [...decoded].some(isForbiddenChar)) {
      return null;
    }
  }
  const prefix = `${config.basePath}/v1/`;
  const target = new URL(`${config.basePath}/v1${rawPath}${query}`, config.origin);
  if (target.origin !== config.origin || !target.pathname.startsWith(prefix)) {
    return null;
  }
  return target;
}

function hasRequestBody(req) {
  return (
    req.headers['transfer-encoding'] !== undefined ||
    (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')
  );
}

function bodyPlan(req, config) {
  if (req.readableEnded) {
    if (req.body === undefined || !hasRequestBody(req)) {
      return { kind: 'none' };
    }
    if (req.is('application/json')) {
      const buffer = Buffer.from(JSON.stringify(req.body), 'utf8');
      return { kind: 'buffer', buffer, contentType: 'application/json; charset=utf-8' };
    }
    throw new ProxyFailure(415, 'unsupported_media_type');
  }
  if (!hasRequestBody(req)) {
    return { kind: 'none' };
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > config.bodyLimitBytes) {
    throw new ProxyFailure(413, 'payload_too_large', { limitMb: config.uploadLimitMb });
  }
  return { kind: 'stream' };
}

function upstreamHeaders(req, plan) {
  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string' && value !== '') {
      headers[name] = value;
    }
  }
  for (const name of PASSTHROUGH_ETUS_HEADERS) {
    const value = req.headers[name];
    if (value === undefined) {
      continue;
    }
    if (
      typeof value !== 'string' ||
      value.length > MAX_ETUS_HEADER_LENGTH ||
      !PRINTABLE_ASCII.test(value)
    ) {
      throw new ProxyFailure(400, 'invalid_header');
    }
    headers[name] = value;
  }
  if (plan.kind === 'buffer') {
    headers['content-type'] = plan.contentType;
    headers['content-length'] = String(plan.buffer.length);
  } else if (plan.kind === 'stream' && req.headers['content-length'] !== undefined) {
    headers['content-length'] = req.headers['content-length'];
  }
  return headers;
}

function currentIdToken(user, now) {
  const info = extractOpenIDTokenInfo(user);
  if (!info?.idToken || typeof info.idTokenExpiresAt !== 'number') {
    return null;
  }
  return info.idTokenExpiresAt * 1000 > now + ID_TOKEN_MIN_REMAINING_MS ? info.idToken : null;
}

function personKeyOf(user) {
  const id = user?.id ?? user?._id;
  return id == null ? null : String(id);
}

function byteLimit(limitBytes) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      seen += chunk.length;
      callback(seen > limitBytes ? new Error('body_limit_exceeded') : null, chunk);
    },
  });
}

function copyResponseHeaders(upstreamRes, res) {
  for (const [name, value] of Object.entries(upstreamRes.headers)) {
    if (DROPPED_RESPONSE_HEADERS.has(name) || name.startsWith('access-control-')) {
      continue;
    }
    res.setHeader(name, value);
  }
  if (upstreamRes.headers['cache-control'] === undefined) {
    res.setHeader('Cache-Control', 'no-store');
  }
}

function forward({ req, res, target, plan, headers, config, timeoutMs, onUnauthorized }) {
  return new Promise((resolve) => {
    const transport = target.protocol === 'https:' ? https : http;
    let responded = false;
    let settled = false;
    let headerTimer;
    const settle = () => {
      if (!settled) {
        settled = true;
        clearTimeout(headerTimer);
        resolve();
      }
    };
    const upstream = transport.request(target, {
      method: req.method,
      headers,
      timeout: timeoutMs,
    });
    upstream.on('finish', () => {
      headerTimer = setTimeout(
        () => upstream.destroy(new ProxyFailure(504, 'design_timeout')),
        timeoutMs,
      );
    });

    const fail = (error) => {
      if (responded) {
        return;
      }
      responded = true;
      const failure =
        error instanceof ProxyFailure ? error : new ProxyFailure(502, 'design_unavailable');
      if (!(error instanceof ProxyFailure) || failure.status >= 500) {
        logger.warn(
          `[EtusDesign] ${req.method} ${target.pathname} failed: ${error?.code ?? error?.name ?? 'Error'}`,
        );
      }
      if (!res.headersSent && !res.destroyed) {
        sendError(res, failure.status, failure.code, {
          details: failure.details,
          closeConnection: plan.kind === 'stream',
        });
      } else {
        res.destroy();
      }
      settle();
    };

    upstream.on('timeout', () => upstream.destroy(new ProxyFailure(504, 'design_timeout')));
    upstream.on('error', fail);
    upstream.on('response', (upstreamRes) => {
      clearTimeout(headerTimer);
      if (responded) {
        upstreamRes.resume();
        return;
      }
      responded = true;
      if (upstreamRes.statusCode === 401) {
        upstreamRes.on('error', () => {});
        upstreamRes.resume();
        if (plan.kind === 'stream') {
          req.unpipe();
          upstream.destroy();
        }
        onUnauthorized();
        logger.warn(`[EtusDesign] design-service refused the forward token on ${target.pathname}`);
        sendError(res, 502, 'design_auth_failed', { closeConnection: plan.kind === 'stream' });
        settle();
        return;
      }
      res.status(upstreamRes.statusCode);
      copyResponseHeaders(upstreamRes, res);
      pipeline(upstreamRes, res, () => settle());
    });

    res.on('close', () => {
      if (!res.writableFinished) {
        upstream.destroy();
      }
      settle();
    });

    if (plan.kind === 'buffer') {
      upstream.end(plan.buffer);
    } else if (plan.kind === 'stream') {
      const limiter = byteLimit(config.bodyLimitBytes);
      limiter.on('error', () => {
        req.unpipe(limiter);
        upstream.destroy(
          new ProxyFailure(413, 'payload_too_large', { limitMb: config.uploadLimitMb }),
        );
      });
      req.pipe(limiter).pipe(upstream);
    } else {
      upstream.end();
    }
  });
}

function createDesignProxy({
  getConfig = getDesignProxyConfig,
  tokens = forwardTokens,
  now = Date.now,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
} = {}) {
  return async function designProxy(req, res) {
    const config = getConfig();
    if (!config) {
      return sendError(res, 404, 'design_disabled');
    }
    if (!ALLOWED_METHODS.has(req.method)) {
      return sendError(res, 405, 'method_not_allowed');
    }
    const target = targetUrl(req, config);
    if (!target) {
      return sendError(res, 404, 'not_found');
    }

    let plan;
    let headers;
    try {
      plan = bodyPlan(req, config);
      headers = upstreamHeaders(req, plan);
    } catch (error) {
      return sendError(res, error.status, error.code, {
        details: error.details,
        closeConnection: true,
      });
    }

    const personKey = personKeyOf(req.user);
    const idToken = personKey ? currentIdToken(req.user, now()) : null;
    if (!idToken) {
      return sendError(res, 401, 'reauth_required', { closeConnection: plan.kind === 'stream' });
    }

    let token;
    try {
      token = await tokens.getToken(personKey, idToken);
    } catch (error) {
      if (!(error instanceof DesignAccessError)) {
        throw error;
      }
      return sendError(res, error.status, error.code, {
        retryAfterSeconds: error.retryAfterSeconds,
        closeConnection: plan.kind === 'stream',
      });
    }

    if (res.destroyed) {
      return;
    }
    await forward({
      req,
      res,
      target,
      plan,
      headers: { ...headers, authorization: `Bearer ${token}` },
      config,
      timeoutMs,
      onUnauthorized: () => tokens.invalidate(personKey),
    });
  };
}

module.exports = {
  UPSTREAM_TIMEOUT_MS,
  DEFAULT_UPLOAD_LIMIT_MB,
  MULTIPART_ALLOWANCE_BYTES,
  FORWARDED_REQUEST_HEADERS,
  PASSTHROUGH_ETUS_HEADERS,
  createDesignProxy,
  getDesignProxyConfig,
  targetUrl,
  designProxy: createDesignProxy(),
};
