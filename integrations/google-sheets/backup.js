/**
 * Backup module for the Google Sheets integration (Bots.Business / BJS).
 *
 * Provides:
 *   - Manual and scheduled backups (full or incremental)
 *   - Backup restoration
 *   - Retention policy enforcement (count + age)
 *   - Backup verification (integrity + optional live reconciliation)
 *
 * Backups are stored as JSON snapshots in a dedicated "backup" sheet range,
 * which keeps everything inside the spreadsheet ecosystem. A pluggable store
 * also supports 'property' / 'memory' backends.
 *
 * @module SheetsBackup
 */

const { createSheetsClient, SheetsValidationError, SheetsError, createLogger, quickHash } =
  require('./main');

const BACKUP_COLUMNS = ['id', 'timestamp', 'type', 'hash', 'size', 'payload'];

/**
 * Creates a backup store. Backends:
 *   - 'sheet'    : writes snapshot rows into a backup sheet range (default)
 *   - 'property' : Bot.getProperty / Bot.setProperty (JSON array)
 *   - 'memory'   : in-process array (lost on restart)
 * @param {Object} options
 * @returns {Object} { add, list, get, remove, clear }
 */
function createBackupStore(options) {
  const backend = options.backend || 'sheet';
  const logger = options.logger;

  if (backend === 'sheet') {
    const client = options.client;
    const range = options.backupRange;
    const sid = options.spreadsheetId;
    return {
      async add(snapshot) {
        const row = [
          snapshot.id, snapshot.timestamp, snapshot.type, snapshot.hash,
          snapshot.size, JSON.stringify(snapshot.payload)
        ];
        await client.appendValues(range, [row], { spreadsheetId: sid });
        return snapshot;
      },
      async list() {
        const rows = await client.getValues(range, { spreadsheetId: sid });
        return rows.slice(1)
          .map((r) => ({ id: r[0], timestamp: r[1], type: r[2], hash: r[3], size: Number(r[4]) || 0 }))
          .filter((b) => b.id);
      },
      async get(id) {
        const rows = await client.getValues(range, { spreadsheetId: sid });
        const hit = rows.slice(1).find((r) => r[0] === id);
        if (!hit) return null;
        return { id: hit[0], timestamp: hit[1], type: hit[2], hash: hit[3], size: Number(hit[4]) || 0, payload: JSON.parse(hit[5] || 'null') };
      },
      async remove(id) {
        // Sheets cannot delete a single row cheaply; mark as deleted by clearing payload.
        const rows = await client.getValues(range, { spreadsheetId: sid });
        const idx = rows.slice(1).findIndex((r) => r[0] === id);
        if (idx < 0) return false;
        const targetRow = idx + 2;
        await client.updateValues(`${range.split('!')[0]}!A${targetRow}:F${targetRow}`, [['', '', 'deleted', '', '', '']], { spreadsheetId: sid });
        return true;
      },
      async clear() {
        await client.clearValues(range, { spreadsheetId: sid });
      }
    };
  }

  if (backend === 'property') {
    const key = options.propertyKey || 'sheets_backups';
    const load = () => {
      try { if (typeof Bot !== 'undefined' && Bot.getProperty) { const v = Bot.getProperty(key); return Array.isArray(v) ? v : []; } } catch (_) {}
      return [];
    };
    const persist = (a) => { try { if (typeof Bot !== 'undefined' && Bot.setProperty) Bot.setProperty(key, a); } catch (e) { logger && logger.warn('persist failed', e.message); } };
    return {
      async add(s) { const a = load(); a.push(s); persist(a); return s; },
      async list() { return load().map((s) => ({ id: s.id, timestamp: s.timestamp, type: s.type, hash: s.hash, size: s.size })); },
      async get(id) { return load().find((s) => s.id === id) || null; },
      async remove(id) { persist(load().filter((s) => s.id !== id)); return true; },
      async clear() { persist([]); }
    };
  }

  // memory
  const arr = [];
  return {
    async add(s) { arr.push(s); return s; },
    async list() { return arr.map((s) => ({ id: s.id, timestamp: s.timestamp, type: s.type, hash: s.hash, size: s.size })); },
    async get(id) { return arr.find((s) => s.id === id) || null; },
    async remove(id) { const i = arr.findIndex((s) => s.id === id); if (i >= 0) arr.splice(i, 1); return true; },
    async clear() { arr.length = 0; }
  };
}

/**
 * Computes a content hash for a 2D data array.
 * @param {Array<Array<string>>} data
 * @returns {string}
 */
function hashData(data) {
  return quickHash(JSON.stringify(data || []));
}

/**
 * Creates a backup manager.
 * @param {Object} options
 * @param {string} options.sourceRange - Range to back up
 * @param {string} [options.spreadsheetId]
 * @param {string} [options.backupRange] - Backup sheet range (for 'sheet' backend)
 * @param {Object} [options.client] / [options.clientConfig]
 * @param {Object} [options.retention] - { maxCount, maxAgeMs, incremental }
 * @param {string} [options.backend] - 'sheet' | 'property' | 'memory'
 * @returns {Object} backup manager API
 */
function createBackupManager(options) {
  if (!options || !options.sourceRange) throw new SheetsValidationError('options.sourceRange is required');
  const client = options.client || createSheetsClient(options.clientConfig || {});
  const logger = client.logger || createLogger({ level: 'info' });
  const store = createBackupStore({
    backend: options.backend || 'sheet',
    client, backupRange: options.backupRange, spreadsheetId: options.spreadsheetId,
    logger
  });
  const retention = options.retention || { maxCount: 30, maxAgeMs: 30 * 24 * 3600 * 1000, incremental: true };

  let timer = null;
  let lastHash = null;

  /**
   * Creates a backup of the source range.
   * @param {Object} [opts] - { label, force }
   * @returns {Promise<Object>} backup descriptor
   */
  async function createBackup(opts) {
    opts = opts || {};
    const data = await client.getValues(options.sourceRange, { spreadsheetId: options.spreadsheetId });
    const hash = hashData(data);

    if (retention.incremental && !opts.force && lastHash === hash) {
      logger.info('No changes since last backup; skipping (incremental mode)');
      return { skipped: true, hash: hash };
    }

    const id = 'bk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const snapshot = {
      id: id,
      timestamp: new Date().toISOString(),
      type: (retention.incremental && lastHash !== null && !opts.force) ? 'incremental' : 'full',
      hash: hash,
      size: JSON.stringify(data).length,
      payload: { data: data, sourceRange: options.sourceRange }
    };
    await store.add(snapshot);
    lastHash = hash;
    logger.info('Backup created: ' + id + ' (' + snapshot.type + ', ' + snapshot.size + ' bytes)');
    return snapshot;
  }

  /**
   * Lists backups (newest first).
   * @returns {Promise<Array>}
   */
  async function listBackups() {
    const list = await store.list();
    return list.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  /**
   * Restores a backup to the source range.
   * @param {string} id - Backup id
   * @param {Object} [opts] - { verify }
   * @returns {Promise<Object>}
   */
  async function restoreBackup(id, opts) {
    opts = opts || {};
    const snap = await store.get(id);
    if (!snap) throw new SheetsError('backup not found: ' + id, 'BACKUP_NOT_FOUND');
    const data = snap.payload && snap.payload.data;
    if (!Array.isArray(data)) throw new SheetsError('backup payload is corrupt', 'BACKUP_CORRUPT');
    await client.updateValues(options.sourceRange, data, { spreadsheetId: options.spreadsheetId });
    lastHash = snap.hash;
    if (opts.verify !== false) {
      const ok = await verifyBackup(id);
      if (!ok.valid) throw new SheetsError('post-restore verification failed', 'VERIFY_FAILED');
    }
    logger.warn('Restored backup ' + id + ' to ' + options.sourceRange);
    return { restored: id, rows: data.length, hash: snap.hash };
  }

  /**
   * Verifies a backup's integrity (and optionally reconciles against source).
   * @param {string} id
   * @param {Object} [opts] - { reconcile }
   * @returns {Promise<Object>}
   */
  async function verifyBackup(id, opts) {
    opts = opts || {};
    const snap = await store.get(id);
    if (!snap) return { valid: false, reason: 'not_found' };
    const data = snap.payload && snap.payload.data;
    if (!Array.isArray(data)) return { valid: false, reason: 'corrupt_payload' };
    const recomputed = hashData(data);
    const matchesStored = recomputed === snap.hash;
    let matchesSource = null;
    if (opts.reconcile) {
      const live = await client.getValues(options.sourceRange, { spreadsheetId: options.spreadsheetId });
      matchesSource = hashData(live) === snap.hash;
    }
    return { valid: matchesStored, reason: matchesStored ? null : 'hash_mismatch', matchesSource: matchesSource, hash: recomputed };
  }

  /**
   * Enforces retention policy: removes backups beyond maxCount (oldest first)
   * and older than maxAgeMs.
   * @returns {Promise<Object>} { removed: string[] }
   */
  async function purgeOldBackups() {
    const list = await listBackups();
    const now = Date.now();
    const removed = [];
    const keep = [];
    list.forEach((b) => {
      const age = now - new Date(b.timestamp).getTime();
      if (age > retention.maxAgeMs) { removed.push(b.id); }
      else keep.push(b);
    });
    // apply count cap on the surviving set (oldest dropped)
    const overflow = keep.slice(retention.maxCount);
    overflow.forEach((b) => removed.push(b.id));
    for (const id of removed) { try { await store.remove(id); } catch (e) { logger.warn('purge failed ' + id, e.message); } }
    if (removed.length) logger.info('Purged ' + removed.length + ' old backup(s)');
    return { removed: removed };
  }

  /**
   * Starts an automatic backup scheduler.
   * @param {Object} opts - { intervalMs, purge } (purge defaults to true)
   * @returns {Object} handle with stop()
   */
  function startScheduler(opts) {
    opts = opts || {};
    const intervalMs = opts.intervalMs || 3600 * 1000;
    if (typeof setInterval !== 'function') {
      throw new SheetsError('setInterval unavailable in this runtime', 'NO_SCHEDULER');
    }
    logger.info('Backup scheduler started (every ' + intervalMs + 'ms)');
    timer = setInterval(async () => {
      try {
        await createBackup({});
        if (opts.purge !== false) await purgeOldBackups();
      } catch (e) {
        logger.error('Scheduled backup failed:', e.message);
      }
    }, intervalMs);
    return {
      stop() { if (timer) { clearInterval(timer); timer = null; logger.info('Backup scheduler stopped'); } }
    };
  }

  return {
    createBackup,
    listBackups,
    restoreBackup,
    verifyBackup,
    purgeOldBackups,
    startScheduler,
    getStore: () => store
  };
}

module.exports = {
  createBackupManager,
  createBackupStore,
  BACKUP_COLUMNS,
  hashData
};
