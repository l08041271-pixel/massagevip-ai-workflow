/**
 * Command Sync module for Google Sheets integration (Bots.Business / BJS).
 *
 * Keeps bot commands defined in a Google Sheet in sync with the running bot.
 * Features:
 *   - Fetch & validate commands from a sheet
 *   - Real-time change detection (checksum based)
 *   - Version control (immutable snapshots per sync)
 *   - Rollback to any previous version
 *
 * The module is storage-agnostic for versions: snapshots can live in-memory,
 * in `Bot.getProperty`, or in a dedicated "backup" sheet.
 *
 * @module CommandSync
 */

const { createSheetsClient, SheetsValidationError, SheetsError, createLogger, quickHash } =
  require('./main');

/** Expected header columns (order matters; extras are allowed after). */
const DEFAULT_COLUMNS = ['command', 'response', 'description', 'enabled', 'tags', 'updated_at'];

/** Validation rules for a command row. */
const COMMAND_NAME_RE = /^\/?[a-zA-Z0-9_][a-zA-Z0-9_\-]{0,63}$/;

/**
 * Validates and normalises a raw command row.
 * @param {Object} row
 * @returns {Object} normalised command
 * @throws {SheetsValidationError}
 */
function normalizeCommand(row) {
  const command = String(row.command || '').trim();
  if (!command) throw new SheetsValidationError('command name is required');
  if (!COMMAND_NAME_RE.test(command)) {
    throw new SheetsValidationError(`invalid command name: "${command}"`);
  }
  const response = row.response == null ? '' : String(row.response);
  if (!response) throw new SheetsValidationError(`command "${command}" requires a response`);

  let enabled = row.enabled;
  if (typeof enabled === 'string') enabled = /^(1|true|yes|on)$/i.test(enabled.trim());
  enabled = enabled !== false;

  const tags = row.tags
    ? String(row.tags).split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    command,
    response,
    description: row.description ? String(row.description) : '',
    enabled,
    tags,
    updatedAt: row.updated_at ? String(row.updated_at) : ''
  };
}

/**
 * Maps a 2D sheet array (with header) into command objects, validating each.
 * @param {Array<Array<string>>} rows
 * @param {Object} [opts] - { columns }
 * @returns {Array<Object>}
 */
function parseCommands(rows, opts = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const columns = opts.columns || DEFAULT_COLUMNS;
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const data = rows.slice(1);

  const colIndex = {};
  columns.forEach((c) => { colIndex[c] = header.indexOf(c); });

  const commands = [];
  const seen = new Set();
  data.forEach((r, i) => {
    const obj = {};
    columns.forEach((c) => {
      const idx = colIndex[c];
      obj[c] = idx >= 0 ? (r[idx] != null ? r[idx] : '') : '';
    });
    // Skip fully empty rows.
    if (!obj.command && !obj.response) return;
    const cmd = normalizeCommand(obj);
    if (seen.has(cmd.command)) {
      throw new SheetsValidationError(`duplicate command "${cmd.command}" at row ${i + 2}`);
    }
    seen.add(cmd.command);
    commands.push(cmd);
  });
  return commands;
}

/**
 * Computes a stable content hash for a list of commands (for change detection).
 * @param {Array<Object>} commands
 * @returns {string}
 */
function computeVersionHash(commands) {
  const canonical = commands
    .map((c) => `${c.command}|${c.response}|${c.enabled ? 1 : 0}|${(c.tags || []).join('+')}`)
    .sort()
    .join('##');
  return quickHash(canonical);
}

/**
 * Creates a version store. Supported backends:
 *   - 'memory'   : process-local Map (default)
 *   - 'property' : Bot.getProperty / Bot.setProperty
 * @param {Object} opts - { backend, propertyKey, logger }
 * @returns {Object} { save, list, get, clear }
 */
function createVersionStore(opts = {}) {
  const backend = opts.backend || 'memory';
  const key = opts.propertyKey || 'sheets_command_versions';
  const logger = opts.logger || createLogger({ level: 'info' });

  if (backend === 'property') {
    const load = () => {
      try {
        if (typeof Bot !== 'undefined' && Bot.getProperty) {
          const v = Bot.getProperty(key);
          return Array.isArray(v) ? v : [];
        }
      } catch (_) {}
      return [];
    };
    const persist = (arr) => {
      try {
        if (typeof Bot !== 'undefined' && Bot.setProperty) Bot.setProperty(key, arr);
      } catch (e) { logger.warn('Failed to persist versions:', e.message); }
    };
    return {
      save(snapshot) { const arr = load(); arr.push(snapshot); persist(arr); },
      list() { return load().map((s) => ({ version: s.version, timestamp: s.timestamp, count: s.commands.length })); },
      get(version) { return load().find((s) => s.version === version) || null; },
      clear() { persist([]); }
    };
  }

  // memory backend
  const store = [];
  return {
    save(snapshot) { store.push(snapshot); },
    list() { return store.map((s) => ({ version: s.version, timestamp: s.timestamp, count: s.commands.length })); },
    get(version) { return store.find((s) => s.version === version) || null; },
    clear() { store.length = 0; }
  };
}

/**
 * Creates a command synchroniser bound to a sheet range.
 *
 * @param {Object} options
 * @param {Object} [options.client] - Pre-built sheets client (optional)
 * @param {Object} [options.clientConfig] - Config to build a client
 * @param {string} options.range - Sheet range, e.g. 'Commands!A1:F'
 * @param {string} [options.spreadsheetId]
 * @param {string} [options.versionBackend] - 'memory' | 'property'
 * @returns {Object} command sync API
 */
function createCommandSync(options) {
  if (!options || !options.range) throw new SheetsValidationError('options.range is required');
  const client = options.client || createSheetsClient(options.clientConfig || {});
  const logger = client.logger || createLogger({ level: 'info' });
  const store = createVersionStore({
    backend: options.versionBackend || 'memory',
    logger
  });

  let lastHash = null;
  let lastVersion = null;

  async function fetchCommands() {
    const rows = await client.getValues(options.range, {
      spreadsheetId: options.spreadsheetId
    });
    const commands = parseCommands(rows);
    return commands;
  }

  /**
   * Performs a full sync: reads the sheet, validates, stores a version
   * snapshot and reports what changed relative to the previous sync.
   * @returns {Promise<Object>} sync result
   */
  async function sync() {
    const commands = await fetchCommands();
    const version = computeVersionHash(commands);
    const changed = version !== lastHash;

    let added = [], updated = [], removed = [];
    if (changed && lastHash !== null) {
      const prev = store.list().length
        ? commands // diffing handled below using last applied set
        : [];
      // Compute diff against previously applied commands (kept in store by version).
      const prevSnap = lastVersion ? store.get(lastVersion) : null;
      const prevMap = new Map((prevSnap ? prevSnap.commands : []).map((c) => [c.command, c]));
      const newMap = new Map(commands.map((c) => [c.command, c]));
      added = commands.filter((c) => !prevMap.has(c.command));
      removed = (prevSnap ? prevSnap.commands : []).filter((c) => !newMap.has(c.command));
      updated = commands.filter((c) => {
        const p = prevMap.get(c.command);
        return p && p.response !== c.response || (p && p.enabled !== c.enabled);
      });
    }

    if (changed) {
      const snapshot = {
        version,
        timestamp: new Date().toISOString(),
        range: options.range,
        spreadsheetId: options.spreadsheetId || client.config.defaultSpreadsheetId,
        commands
      };
      store.save(snapshot);
      lastHash = version;
      lastVersion = version;
      logger.info(`Command sync complete: ${commands.length} commands, version ${version}` +
        (changed ? ` (${added.length} added, ${updated.length} updated, ${removed.length} removed)` : ''));
    }

    return {
      changed,
      version,
      count: commands.length,
      added: added.map((c) => c.command),
      updated: updated.map((c) => c.command),
      removed: removed.map((c) => c.command),
      enabled: commands.filter((c) => c.enabled).map((c) => c.command),
      commands
    };
  }

  /**
   * Lightweight change detection without storing a new version. Useful for
   * polling "has anything changed?" before doing a full sync.
   * @returns {Promise<{changed: boolean, version: string, diff: Object}>}
   */
  async function watch() {
    const commands = await fetchCommands();
    const version = computeVersionHash(commands);
    const changed = version !== lastHash;
    let diff = { added: [], updated: [], removed: [] };
    if (changed && lastVersion) {
      const prevSnap = store.get(lastVersion);
      const prevMap = new Map((prevSnap ? prevSnap.commands : []).map((c) => [c.command, c]));
      const newMap = new Map(commands.map((c) => [c.command, c]));
      diff.added = commands.filter((c) => !prevMap.has(c.command)).map((c) => c.command);
      diff.removed = (prevSnap ? prevSnap.commands : []).filter((c) => !newMap.has(c.command)).map((c) => c.command);
      diff.updated = commands.filter((c) => {
        const p = prevMap.get(c.command);
        return p && (p.response !== c.response || p.enabled !== c.enabled);
      }).map((c) => c.command);
    }
    return { changed, version, diff };
  }

  /**
   * Returns the active command set (must have synced at least once).
   * @returns {Array<Object>}
   */
  function getActiveCommands() {
    if (!lastVersion) return [];
    const snap = store.get(lastVersion);
    return snap ? snap.commands : [];
  }

  /**
   * Rolls the sheet back to a previously stored version by overwriting the
   * command range with the snapshot's content (including the header row).
   * @param {string} version - Target version hash
   * @returns {Promise<Object>} result
   */
  async function rollback(version) {
    const snap = store.get(version);
    if (!snap) throw new SheetsError(`version ${version} not found`, 'VERSION_NOT_FOUND');
    const rows = [DEFAULT_COLUMNS];
    snap.commands.forEach((c) => {
      rows.push([
        c.command,
        c.response,
        c.description,
        c.enabled ? 'TRUE' : 'FALSE',
        (c.tags || []).join(','),
        c.updatedAt || new Date().toISOString()
      ]);
    });
    await client.updateValues(options.range, rows, {
      spreadsheetId: options.spreadsheetId
    });
    // Re-sync to refresh state.
    const result = await sync();
    logger.warn(`Rolled back to version ${version} (now ${result.version})`);
    return { rolledBackTo: version, current: result.version, count: result.count };
  }

  return {
    fetchCommands,
    sync,
    watch,
    rollback,
    getActiveCommands,
    listVersions: () => store.list(),
    getVersion: (v) => store.get(v),
    clearVersions: () => store.clear(),
    parseCommands
  };
}

module.exports = {
  createCommandSync,
  parseCommands,
  normalizeCommand,
  computeVersionHash,
  DEFAULT_COLUMNS,
  COMMAND_NAME_RE
};
