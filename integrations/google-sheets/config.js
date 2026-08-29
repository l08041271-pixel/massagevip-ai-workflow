/**
 * Configuration module for the Google Sheets integration (Bots.Business / BJS).
 *
 * Provides environment-based configuration, credential management, rate
 * limiting settings and feature flags. Configuration is resolved at runtime
 * by merging, in order of precedence (lowest to highest):
 *
 *   1. DEFAULT_CONFIG        (sensible, safe defaults)
 *   2. stored properties     (Bot.getProperty / process.env)
 *   3. explicit `overrides`  (passed by the caller)
 *
 * The module is intentionally free of side effects: it never performs network
 * calls and only reads configuration when `loadConfig()` is invoked.
 *
 * @module SheetsConfig
 */

/**
 * Reads a value from the available configuration sources.
 *
 * Bots.Business does not expose `process.env` the same way Node does, so this
 * helper transparently supports both a real Node `process.env` and the BJS
 * `Bot.getProperty` store. Values may be JSON-encoded.
 *
 * @private
 * @param {string} key - Configuration key
 * @param {*} fallback - Value to return when nothing is found
 * @returns {*}
 */
function readStored(key, fallback) {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key] !== undefined) {
      const raw = process.env[key];
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      const num = Number(raw);
      if (raw !== '' && !Number.isNaN(num) && raw.trim() === String(num)) return num;
      return raw;
    }
  } catch (_) { /* process may be undefined in the sandbox */ }

  try {
    if (typeof Bot !== 'undefined' && typeof Bot.getProperty === 'function') {
      const val = Bot.getProperty(key);
      if (val !== undefined && val !== null && val !== '') return val;
    }
  } catch (_) { /* Bot may be unavailable outside the runtime */ }

  return fallback;
}

/**
 * Default configuration. All values are overridable via `loadConfig()`.
 * @type {Object}
 */
const DEFAULT_CONFIG = {
  /** Google Sheets API v4 base endpoint. */
  apiBaseUrl: 'https://sheets.googleapis.com/v4',

  /** OAuth2 token endpoint used for refreshing / exchanging credentials. */
  tokenUrl: 'https://oauth2.googleapis.com/token',

  /**
   * Authentication configuration.
   *
   * Supported `mode` values:
   *   - 'apiKey'         : read-only access to publicly shared sheets.
   *   - 'oauth'          : access token supplied directly (short lived).
   *   - 'refreshToken'   : long-lived refresh token exchanged for access tokens.
   *   - 'serviceAccount' : Google service account (JWT bearer grant).
   */
  auth: {
    mode: 'refreshToken',
    apiKey: '',
    accessToken: '',
    tokenExpiry: 0,
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    serviceAccount: null, // { client_email, private_key, scopes }
    scopes: 'https://www.googleapis.com/auth/spreadsheets'
  },

  /**
   * Retry / resilience settings.
   * @type {Object}
   */
  retry: {
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 15000,
    /** HTTP status codes that are considered transient and retried. */
    retryableStatuses: [408, 429, 500, 502, 503, 504],
    /** Multiplier for exponential backoff. */
    backoffFactor: 2,
    /** Random jitter fraction (0-1) added to each delay. */
    jitter: 0.25
  },

  /**
   * Client-side rate limiting (token bucket). Google Sheets has a quota of
   * ~60 read requests/minute per project; this protects against 429s.
   * @type {Object}
   */
  rateLimit: {
    enabled: true,
    /** Maximum requests per window. */
    maxTokens: 50,
    /** Window size in milliseconds. */
    windowMs: 60000,
    /** How many requests may burst above the average. */
    burst: 10
  },

  /**
   * Request defaults applied to every Sheets call.
   * @type {Object}
   */
  request: {
    timeoutMs: 30000,
    /** Default value input option for writes. */
    valueInputOption: 'USER_ENTERED',
    /** Default insert data option for appends. */
    insertDataOption: 'INSERT_ROWS'
  },

  /**
   * Logging configuration.
   * @type {Object}
   */
  logging: {
    level: 'info', // 'debug' | 'info' | 'warn' | 'error' | 'silent'
    prefix: 'Sheets'
  },

  /**
   * Feature flags to toggle optional behaviour at runtime.
   * @type {Object}
   */
  features: {
    batchEnabled: true,
    incrementalBackup: true,
    validateOnRead: true,
    cacheEnabled: false,
    /** When true, failed writes are queued and retried on next call. */
    deadLetterQueue: false
  },

  /**
   * Default spreadsheet used when callers omit `spreadsheetId`. Leave empty
   * to force callers to always specify it.
   * @type {string}
   */
  defaultSpreadsheetId: '',

  /**
   * Cache settings (used when features.cacheEnabled is true).
   * @type {Object}
   */
  cache: {
    ttlMs: 60000,
    maxEntries: 100
  }
};

/**
 * Deep-merges `source` into `target` (one level of object nesting is enough
 * for our config shape, but we recurse to be safe). Arrays are replaced, not
 * concatenated.
 *
 * @private
 * @param {Object} target - Base object (mutated and returned)
 * @param {Object} source - Override object
 * @returns {Object} merged target
 */
function deepMerge(target, source) {
  if (!source) return target;
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv && typeof sv === 'object' && !Array.isArray(sv) &&
      tv && typeof tv === 'object' && !Array.isArray(tv)
    ) {
      deepMerge(tv, sv);
    } else if (sv !== undefined) {
      target[key] = sv;
    }
  }
  return target;
}

/**
 * Resolves the final configuration.
 *
 * Precedence (lowest -> highest): defaults < stored properties < overrides.
 * Only a curated set of keys are read from the stored layer to avoid leaking
 * arbitrary runtime state into the configuration.
 *
 * @param {Object} [overrides] - Caller-supplied overrides
 * @returns {Object} fully resolved configuration (a deep clone of defaults)
 */
function loadConfig(overrides) {
  const cfg = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), null);

  // Pull selected secrets / identifiers from the stored layer.
  const stored = {
    auth: {
      apiKey: readStored('SHEETS_API_KEY', DEFAULT_CONFIG.auth.apiKey),
      accessToken: readStored('SHEETS_ACCESS_TOKEN', DEFAULT_CONFIG.auth.accessToken),
      clientId: readStored('SHEETS_CLIENT_ID', DEFAULT_CONFIG.auth.clientId),
      clientSecret: readStored('SHEETS_CLIENT_SECRET', DEFAULT_CONFIG.auth.clientSecret),
      refreshToken: readStored('SHEETS_REFRESH_TOKEN', DEFAULT_CONFIG.auth.refreshToken)
    },
    defaultSpreadsheetId: readStored('SHEETS_SPREADSHEET_ID', DEFAULT_CONFIG.defaultSpreadsheetId),
    logging: {
      level: readStored('SHEETS_LOG_LEVEL', DEFAULT_CONFIG.logging.level)
    }
  };

  deepMerge(cfg, stored);
  deepMerge(cfg, overrides || {});

  // Validate critical configuration.
  if (!cfg.defaultSpreadsheetId && !(overrides && overrides.spreadsheetId) && !readStored('SHEETS_SPREADSHEET_ID', '')) {
    // Not fatal: callers can still pass spreadsheetId per call.
  }

  return cfg;
}

/**
 * Returns the default spreadsheet id, preferring explicit overrides then the
 * resolved stored value.
 * @param {Object} [overrides] - Optional overrides
 * @returns {string}
 */
function getDefaultSpreadsheetId(overrides) {
  if (overrides && overrides.spreadsheetId) return overrides.spreadsheetId;
  return readStored('SHEETS_SPREADSHEET_ID', DEFAULT_CONFIG.defaultSpreadsheetId);
}

module.exports = {
  DEFAULT_CONFIG,
  loadConfig,
  getDefaultSpreadsheetId,
  readStored,
  deepMerge
};
