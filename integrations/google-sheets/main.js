/**
 * Google Sheets API v4 integration for Bots.Business (BJS).
 *
 * Production-ready client providing:
 *   - Service-account / OAuth / API-key authentication
 *   - Read, write, append and clear operations
 *   - Batch operations for throughput
 *   - Exponential backoff with jitter and rate limiting
 *   - Structured error handling and logging
 *
 * The module is built around the global `HTTP` object provided by the BJS
 * runtime (same primitive used by other integration modules in this repo).
 * If a Node `require('crypto')` is available it additionally supports the
 * service-account JWT bearer grant; otherwise callers should use the
 * `refreshToken` auth mode.
 *
 * @module GoogleSheets
 */

const { loadConfig, getDefaultSpreadsheetId } = require('./config');

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Base error for all Sheets integration failures, carrying a stable machine
 * readable `code` and the originating HTTP status when relevant.
 */
class SheetsError extends Error {
  /**
   * @param {string} message - Human readable message
   * @param {string} [code] - Stable error code
   * @param {Object} [meta] - Extra context (status, attempt, etc.)
   */
  constructor(message, code = 'SHEETS_ERROR', meta = {}) {
    super(message);
    this.name = 'SheetsError';
    this.code = code;
    this.meta = meta;
    Error.captureStackTrace && Error.captureStackTrace(this, SheetsError);
  }
}

class SheetsAuthError extends SheetsError {
  constructor(message, meta) { super(message, 'AUTH_ERROR', meta); this.name = 'SheetsAuthError'; }
}
class SheetsRateLimitError extends SheetsError {
  constructor(message, meta) { super(message, 'RATE_LIMITED', meta); this.name = 'SheetsRateLimitError'; }
}
class SheetsValidationError extends SheetsError {
  constructor(message, meta) { super(message, 'VALIDATION_ERROR', meta); this.name = 'SheetsValidationError'; }
}
class SheetsNotFoundError extends SheetsError {
  constructor(message, meta) { super(message, 'NOT_FOUND', meta); this.name = 'SheetsNotFoundError'; }
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Creates a level-aware logger that prefixes messages and degrades gracefully
 * when `console` is unavailable.
 * @param {Object} opts - { level, prefix }
 * @returns {Object} logger with debug/info/warn/error
 */
function createLogger(opts) {
  const level = LEVELS[opts && opts.level] !== undefined ? LEVELS[opts.level] : LEVELS.info;
  const prefix = (opts && opts.prefix) || 'Sheets';
  const hasConsole = typeof console !== 'undefined' && console.log;
  const emit = (lvl, fn, args) => {
    if (lvl < level) return;
    const ts = new Date().toISOString();
    const msg = [`[${ts}] [${prefix}]`, ...args];
    if (hasConsole) fn.apply(console, msg);
  };
  return {
    debug: (...a) => emit(LEVELS.debug, console.log, a),
    info: (...a) => emit(LEVELS.info, console.log, a),
    warn: (...a) => emit(LEVELS.warn, console.warn, a),
    error: (...a) => emit(LEVELS.error, console.error, a)
  };
}

/**
 * Promise-based sleep, tolerant of runtimes without setTimeout.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') setTimeout(resolve, ms);
    else resolve();
  });
}

/**
 * Computes a backoff delay (ms) with exponential growth and jitter.
 * @param {number} attempt - Zero-based attempt index
 * @param {Object} retryCfg
 * @returns {number}
 */
function backoffDelay(attempt, retryCfg) {
  const exp = Math.min(
    retryCfg.maxDelayMs,
    retryCfg.baseDelayMs * Math.pow(retryCfg.backoffFactor, attempt)
  );
  const jitter = exp * retryCfg.jitter * Math.random();
  return Math.round(exp + jitter);
}

/**
 * Deterministic, non-cryptographic hash used for change detection and
 * deduplication. Not suitable for security, only for equality checks.
 * @param {string} str
 * @returns {string}
 */
function quickHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* -------------------------------------------------------------------------- */
/* Rate limiter (token bucket)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Simple token-bucket rate limiter.
 * @param {Object} cfg - { enabled, maxTokens, windowMs, burst }
 * @param {Object} logger
 */
function createRateLimiter(cfg, logger) {
  let tokens = cfg.enabled ? cfg.maxTokens : Infinity;
  let last = Date.now();

  async function acquire() {
    if (!cfg.enabled) return;
    const now = Date.now();
    const elapsed = now - last;
    // Refill proportional to elapsed time, capped at max+burst.
    const refill = (elapsed / cfg.windowMs) * cfg.maxTokens;
    tokens = Math.min(cfg.maxTokens + (cfg.burst || 0), tokens + refill);
    last = now;

    if (tokens >= 1) {
      tokens -= 1;
      return;
    }
    // Not enough tokens: wait until the bucket refills one token.
    const deficit = 1 - tokens;
    const waitMs = Math.ceil((deficit / cfg.maxTokens) * cfg.windowMs);
    logger.debug(`Rate limit reached; throttling ${waitMs}ms`);
    await sleep(waitMs);
    tokens = 0;
  }

  return { acquire };
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Exchanges a refresh token for a fresh access token via the OAuth2 endpoint.
 * @param {Object} auth
 * @param {Object} cfg
 * @param {Object} logger
 * @returns {Promise<string>} access token
 */
async function exchangeRefreshToken(auth, cfg, logger) {
  if (!auth.refreshToken || !auth.clientId || !auth.clientSecret) {
    throw new SheetsAuthError('Missing refreshToken / clientId / clientSecret for token refresh');
  }
  const body = [
    'grant_type=refresh_token',
    `client_id=${encodeURIComponent(auth.clientId)}`,
    `client_secret=${encodeURIComponent(auth.clientSecret)}`,
    `refresh_token=${encodeURIComponent(auth.refreshToken)}`
  ].join('&');

  logger.debug('Exchanging refresh token for access token');
  const res = HTTP.post(cfg.tokenUrl, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!res || res.error) {
    throw new SheetsAuthError('Token refresh failed: ' + (res && res.error || 'unknown error'));
  }
  const data = typeof res === 'string' ? JSON.parse(res) : res;
  if (!data.access_token) {
    throw new SheetsAuthError('Token endpoint returned no access_token');
  }
  auth.accessToken = data.access_token;
  auth.tokenExpiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return data.access_token;
}

/**
 * Signs a service-account JWT and exchanges it for an access token.
 * Requires a real `crypto` module; throws a helpful error otherwise.
 * @param {Object} auth
 * @param {Object} cfg
 * @param {Object} logger
 * @returns {Promise<string>}
 */
async function exchangeServiceAccount(auth, cfg, logger) {
  const sa = auth.serviceAccount;
  if (!sa || !sa.client_email || !sa.private_key) {
    throw new SheetsAuthError('Service account requires client_email and private_key');
  }

  let crypto;
  try {
    crypto = require('crypto');
  } catch (_) {
    throw new SheetsAuthError(
      'Service-account (JWT) auth requires a crypto module. Use refreshToken mode instead.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: auth.scopes,
    aud: cfg.tokenUrl,
    iat: now,
    exp: now + 3600
  })).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(sa.private_key, 'base64url');
  const assertion = `${header}.${claim}.${signature}`;

  logger.debug('Exchanging service-account JWT for access token');
  const res = HTTP.post(cfg.tokenUrl, `grant_type=${encodeURIComponent(
    'urn:ietf:params:oauth:grant-type:jwt-bearer'
  )}&assertion=${encodeURIComponent(assertion)}`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!res || res.error) {
    throw new SheetsAuthError('Service account exchange failed: ' + (res && res.error || 'unknown'));
  }
  const data = typeof res === 'string' ? JSON.parse(res) : res;
  auth.accessToken = data.access_token;
  auth.tokenExpiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return data.access_token;
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates a configured Google Sheets API client.
 *
 * @param {Object} [userConfig] - Configuration overrides (see config.js)
 * @returns {Object} sheets client API
 */
function createSheetsClient(userConfig) {
  const cfg = loadConfig(userConfig);
  const logger = createLogger(cfg.logging);
  const limiter = createRateLimiter(cfg.rateLimit, logger);

  /* ----- auth helpers ----- */

  async function ensureAccessToken() {
    if (cfg.auth.mode === 'apiKey') return null;
    const fresh = cfg.auth.accessToken && cfg.auth.tokenExpiry > Date.now() + 5000;
    if (fresh) return cfg.auth.accessToken;

    if (cfg.auth.mode === 'refreshToken' || cfg.auth.refreshToken) {
      return exchangeRefreshToken(cfg.auth, cfg, logger);
    }
    if (cfg.auth.mode === 'serviceAccount') {
      return exchangeServiceAccount(cfg.auth, cfg, logger);
    }
    if (cfg.auth.mode === 'oauth' && cfg.auth.accessToken) {
      return cfg.auth.accessToken;
    }
    throw new SheetsAuthError(`Unsupported or incomplete auth mode: ${cfg.auth.mode}`);
  }

  /* ----- low level request ----- */

  async function request(method, path, body, opts = {}) {
    await limiter.acquire();

    const token = await ensureAccessToken().catch((e) => {
      // Allow read with apiKey even if token logic misconfigured.
      if (cfg.auth.mode === 'apiKey') return null;
      throw e;
    });

    const headers = { 'Accept': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body && method !== 'GET') headers['Content-Type'] = 'application/json';

    let url = `${cfg.apiBaseUrl}${path}`;
    if (cfg.auth.mode === 'apiKey' && cfg.auth.apiKey) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + `key=${encodeURIComponent(cfg.auth.apiKey)}`;
    }

    let attempt = 0;
    const maxAttempts = (opts.maxAttempts != null) ? opts.maxAttempts : cfg.retry.maxAttempts;

    while (true) {
      try {
        let res;
        const payload = body && method !== 'GET' ? JSON.stringify(body) : null;
        if (method === 'GET') res = HTTP.get(url, { headers });
        else if (method === 'POST') res = HTTP.post(url, payload, { headers });
        else if (method === 'PUT') res = HTTP.put ? HTTP.put(url, payload, { headers }) : unsupported('PUT');
        else if (method === 'DELETE') res = HTTP.delete ? HTTP.delete(url, { headers }) : unsupported('DELETE');
        else throw new SheetsError(`Unsupported method: ${method}`);

        // HTTP primitive returns either parsed object or { error }.
        if (res && res.error) {
          throw normalizeHttpError(res, url);
        }
        if (res && typeof res === 'object' && res.error !== undefined && res.error) {
          throw normalizeHttpError(res, url);
        }

        // Some runtimes return raw strings.
        if (typeof res === 'string') {
          try { return JSON.parse(res); } catch (_) { return res; }
        }
        return res || {};
      } catch (err) {
        const status = err.meta && err.meta.status;
        const retryable = cfg.retry.retryableStatuses.includes(status) || err.code === 'NETWORK_ERROR';
        if (!retryable || attempt >= maxAttempts - 1) {
          throw err;
        }
        const delay = backoffDelay(attempt, cfg.retry);
        logger.warn(`Request to ${path} failed (${status || err.code}); retry ${attempt + 1}/${maxAttempts} in ${delay}ms`);
        await sleep(delay);
        attempt++;
      }
    }
  }

  function unsupported(m) {
    throw new SheetsError(`${m} is not supported by the runtime HTTP primitive`);
  }

  /**
   * Normalizes a raw HTTP error object into a typed SheetsError.
   * @private
   */
  function normalizeHttpError(res, url) {
    const status = res.status || res.code || null;
    let message = res.error || res.message || 'HTTP request failed';
    let code = 'HTTP_ERROR';
    if (status === 404) { code = 'NOT_FOUND'; message = `Resource not found: ${url}`; }
    else if (status === 401 || status === 403) { code = 'AUTH_ERROR'; }
    else if (status === 429) { code = 'RATE_LIMITED'; }
    else if (status >= 500) { code = 'SERVER_ERROR'; }
    else if (!status) { code = 'NETWORK_ERROR'; }
    return new SheetsError(message, code, { status, url });
  }

  /* ----- public read API ----- */

  /**
   * Reads values from a range.
   * @param {string} range - A1 notation, e.g. 'Sheet1!A1:D'
   * @param {Object} [opts] - { spreadsheetId, majorDimension }
   * @returns {Promise<Array<Array<string>>>} 2D array of values
   */
  async function getValues(range, opts = {}) {
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid) throw new SheetsValidationError('spreadsheetId is required');
    if (!range) throw new SheetsValidationError('range is required');
    const dim = opts.majorDimension ? `&majorDimension=${opts.majorDimension}` : '';
    const res = await request('GET', `/spreadsheets/${encodeURIComponent(sid)}/values/${encodeURIComponent(range)}?${dim}`);
    return (res && res.values) || [];
  }

  /**
   * Reads multiple ranges in a single batch call.
   * @param {Array<string>} ranges
   * @param {Object} [opts] - { spreadsheetId, majorDimension }
   * @returns {Promise<Array<Array<string>>>} concatenated values
   */
  async function batchGetValues(ranges, opts = {}) {
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid) throw new SheetsValidationError('spreadsheetId is required');
    if (!Array.isArray(ranges) || !ranges.length) throw new SheetsValidationError('ranges must be a non-empty array');
    const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const dim = opts.majorDimension ? `&majorDimension=${opts.majorDimension}` : '';
    const res = await request('GET', `/spreadsheets/${encodeURIComponent(sid)}/values:batchGet?${params}${dim}`);
    const valueRanges = (res && res.valueRanges) || [];
    return valueRanges.map((vr) => vr.values || []);
  }

  /**
   * Appends rows to a range (creates new rows at the bottom).
   * @param {string} range
   * @param {Array<Array<string>>} values
   * @param {Object} [opts]
   * @returns {Promise<Object>} API response
   */
  async function appendValues(range, values, opts = {}) {
    validateValues(values);
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid || !range) throw new SheetsValidationError('spreadsheetId and range are required');
    const vio = opts.valueInputOption || cfg.request.valueInputOption;
    const ido = opts.insertDataOption || cfg.request.insertDataOption;
    const path = `/spreadsheets/${encodeURIComponent(sid)}/values/${encodeURIComponent(range)}:append?valueInputOption=${vio}&insertDataOption=${ido}`;
    return request('POST', path, { values });
  }

  /**
   * Overwrites a range with the provided values.
   * @param {string} range
   * @param {Array<Array<string>>} values
   * @param {Object} [opts]
   * @returns {Promise<Object>}
   */
  async function updateValues(range, values, opts = {}) {
    validateValues(values);
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid || !range) throw new SheetsValidationError('spreadsheetId and range are required');
    const vio = opts.valueInputOption || cfg.request.valueInputOption;
    const path = `/spreadsheets/${encodeURIComponent(sid)}/values/${encodeURIComponent(range)}?valueInputOption=${vio}`;
    return request('POST', path, { values });
  }

  /**
   * Clears a range (keeps formatting, removes values).
   * @param {string} range
   * @param {Object} [opts]
   * @returns {Promise<Object>}
   */
  async function clearValues(range, opts = {}) {
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid || !range) throw new SheetsValidationError('spreadsheetId and range are required');
    return request('POST', `/spreadsheets/${encodeURIComponent(sid)}/values/${encodeURIComponent(range)}:clear`, {});
  }

  /**
   * Performs multiple write operations in a single batch request.
   * @param {Array<Object>} operations - Each: { range, values, valueInputOption?, majorDimension? }
   * @param {Object} [opts] - { spreadsheetId, valueInputOption }
   * @returns {Promise<Object>}
   */
  async function batchUpdate(operations, opts = {}) {
    if (!cfg.features.batchEnabled) {
      // Fall back to sequential updates for safety.
      const out = [];
      for (const op of operations) out.push(await updateValues(op.range, op.values, opts));
      return { responses: out };
    }
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid) throw new SheetsValidationError('spreadsheetId is required');
    if (!Array.isArray(operations) || !operations.length) throw new SheetsValidationError('operations must be a non-empty array');
    const vio = opts.valueInputOption || cfg.request.valueInputOption;
    const data = operations.map((op) => {
      validateValues(op.values);
      return {
        range: op.range,
        majorDimension: op.majorDimension || 'ROWS',
        values: op.values
      };
    });
    return request('POST', `/spreadsheets/${encodeURIComponent(sid)}/values:batchUpdate?valueInputOption=${vio}`, { data });
  }

  /**
   * Validates that values are a 2D array of primitives.
   * @private
   */
  function validateValues(values) {
    if (!Array.isArray(values)) throw new SheetsValidationError('values must be an array of rows');
    for (const row of values) {
      if (!Array.isArray(row)) throw new SheetsValidationError('each row must be an array');
      for (const cell of row) {
        const t = typeof cell;
        if (!(t === 'string' || t === 'number' || t === 'boolean' || cell == null)) {
          throw new SheetsValidationError(`unsupported cell type: ${t}`);
        }
      }
    }
  }

  /**
   * Returns spreadsheet metadata (sheets, properties).
   * @param {Object} [opts] - { spreadsheetId }
   * @returns {Promise<Object>}
   */
  async function getSpreadsheet(opts = {}) {
    const sid = opts.spreadsheetId || cfg.defaultSpreadsheetId;
    if (!sid) throw new SheetsValidationError('spreadsheetId is required');
    return request('GET', `/spreadsheets/${encodeURIComponent(sid)}`);
  }

  return {
    config: cfg,
    logger,
    // auth
    ensureAccessToken,
    // reads
    getValues,
    batchGetValues,
    // writes
    appendValues,
    updateValues,
    clearValues,
    batchUpdate,
    // metadata
    getSpreadsheet,
    // helpers (exposed for advanced use)
    request,
    _validateValues: validateValues
  };
}

module.exports = {
  createSheetsClient,
  SheetsError,
  SheetsAuthError,
  SheetsRateLimitError,
  SheetsValidationError,
  SheetsNotFoundError,
  // exported for reuse by sibling modules
  createLogger,
  createRateLimiter,
  quickHash,
  sleep,
  backoffDelay,
  getDefaultSpreadsheetId,
  loadConfig
};
