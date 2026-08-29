/**
 * CSV Import module for the Google Sheets integration (Bots.Business / BJS).
 *
 * Reads tabular data (either raw CSV text or a Google Sheet range), validates
 * and transforms it against a schema, detects duplicates, reports progress and
 * accumulates per-row errors without aborting the whole import.
 *
 * @module CsvImport
 */

const { createSheetsClient, SheetsValidationError, createLogger } = require('./main');

/* -------------------------------------------------------------------------- */
/* CSV parsing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Parses a CSV string into an array of row arrays.
 * Handles quoted fields, embedded commas / newlines and escaped quotes ("").
 *
 * @param {string} text - Raw CSV content
 * @param {Object} [opts] - { delimiter }
 * @returns {Array<Array<string>>}
 */
function parseCSV(text, opts) {
  const delimiter = (opts && opts.delimiter) || ',';
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Field transforms / validators                                             */
/* -------------------------------------------------------------------------- */

const TYPE_COERCERS = {
  string: function (v) { return v == null ? '' : String(v).trim(); },
  number: function (v) {
    const n = Number(String(v).replace(/[,\s]/g, ''));
    if (Number.isNaN(n)) throw new SheetsValidationError('not a number: "' + v + '"');
    return n;
  },
  boolean: function (v) {
    if (typeof v === 'boolean') return v;
    return /^(1|true|yes|on|y)$/i.test(String(v).trim());
  },
  date: function (v) {
    const d = new Date(String(v).trim());
    if (Number.isNaN(d.getTime())) throw new SheetsValidationError('invalid date: "' + v + '"');
    return d.toISOString();
  },
  email: function (v) {
    const s = String(v).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new SheetsValidationError('invalid email: "' + v + '"');
    return s.toLowerCase();
  }
};

/**
 * Validates and transforms a single record against a schema.
 * @param {Object} raw - Map of field name -> value
 * @param {Array<Object>} schema
 * @returns {Object} normalized record
 */
function transformRecord(raw, schema) {
  const out = {};
  for (let f = 0; f < schema.length; f++) {
    const field = schema[f];
    let value = raw[field.name];
    if (value == null || value === '') {
      if (field.default !== undefined) value = field.default;
      else if (field.required) throw new SheetsValidationError('missing required field "' + field.name + '"');
      else { out[field.name] = field.default !== undefined ? field.default : null; continue; }
    }
    const coerce = TYPE_COERCERS[field.type] || TYPE_COERCERS.string;
    value = coerce(value);
    if (field.validate && typeof field.validate === 'function') {
      if (!field.validate(value)) throw new SheetsValidationError('validation failed for "' + field.name + '"');
    }
    if (field.transform && typeof field.transform === 'function') value = field.transform(value);
    out[field.name] = value;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Importer                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Builds a record map from a header row + data rows.
 * @param {Array<Array<string>>} rows
 * @returns {Array<Object>}
 */
function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  return rows.slice(1).map(function (r) {
    const obj = {};
    header.forEach(function (h, idx) { obj[h] = r[idx] != null ? r[idx] : ''; });
    return obj;
  });
}

/**
 * Creates a CSV importer.
 * @param {Object} [opts] - { client, clientConfig, logger }
 * @returns {Object} importer API
 */
function createCsvImporter(opts) {
  opts = opts || {};
  const client = opts.client || (opts.clientConfig ? createSheetsClient(opts.clientConfig) : null);
  const logger = opts.logger || createLogger({ level: 'info' });

  /**
   * Imports data from a Google Sheet range.
   */
  async function importFromSheet(params) {
    if (!client) throw new SheetsValidationError('a sheets client is required for importFromSheet');
    if (!params.schema || !Array.isArray(params.schema)) throw new SheetsValidationError('schema is required');
    const rows = await client.getValues(params.range, { spreadsheetId: params.spreadsheetId });
    return runImport(rowsToObjects(rows), params);
  }

  /**
   * Imports from raw CSV text (no Sheets client needed).
   */
  async function importFromText(csvText, params) {
    if (!params.schema || !Array.isArray(params.schema)) throw new SheetsValidationError('schema is required');
    const rows = parseCSV(csvText, params.options || {});
    return runImport(rowsToObjects(rows), params);
  }

  /**
   * Core import engine shared by both sources.
   */
  async function runImport(records, params) {
    const schema = params.schema;
    const opt = params.options || {};
    const dedupeKeys = opt.dedupeKeys || schema.filter(function (f) { return f.unique; }).map(function (f) { return f.name; });
    const mode = opt.mode || 'insert';
    const onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : null;
    const onRow = typeof opt.onRow === 'function' ? opt.onRow : null;

    const summary = {
      total: records.length,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      duplicates: [],
      durationMs: 0,
      startedAt: new Date().toISOString()
    };

    const seen = new Map();
    const t0 = Date.now();

    for (let idx = 0; idx < records.length; idx++) {
      const raw = records[idx];
      const rowNo = idx + 2;
      try {
        const record = transformRecord(raw, schema);
        if (dedupeKeys.length) {
          const key = dedupeKeys.map(function (k) { return String(record[k]); }).join('|');
          if (seen.has(key)) {
            summary.duplicates.push({ row: rowNo, key: key });
            if (mode === 'insert') {
              summary.skipped++; summary.processed++; report(); continue;
            }
            seen.set(key, record);
            summary.updated++; summary.processed++;
            if (onRow) onRow({ action: 'update', row: rowNo, record: record });
            report(); continue;
          }
          seen.set(key, record);
        }
        summary.inserted++; summary.processed++;
        if (onRow) onRow({ action: 'insert', row: rowNo, record: record });
      } catch (err) {
        summary.errors.push({ row: rowNo, message: err.message, code: err.code || 'VALIDATION_ERROR', data: raw });
        summary.processed++;
      }
      report();
    }

    summary.durationMs = Date.now() - t0;
    summary.finishedAt = new Date().toISOString();
    summary.records = seen.size ? Array.from(seen.values()) : [];
    logger.info('Import finished: ' + summary.inserted + ' inserted, ' + summary.updated +
      ' updated, ' + summary.skipped + ' skipped, ' + summary.errors.length + ' errors');
    return summary;

    function report() {
      if (!onProgress) return;
      const percent = summary.total ? Math.round((summary.processed / summary.total) * 100) : 100;
      onProgress({
        processed: summary.processed,
        total: summary.total,
        percent: percent,
        inserted: summary.inserted,
        updated: summary.updated,
        skipped: summary.skipped,
        errors: summary.errors.length
      });
    }
  }

  return { importFromSheet: importFromSheet, importFromText: importFromText, parseCSV: parseCSV, transformRecord: transformRecord };
}

module.exports = {
  createCsvImporter: createCsvImporter,
  parseCSV: parseCSV,
  transformRecord: transformRecord,
  rowsToObjects: rowsToObjects,
  TYPE_COERCERS: TYPE_COERCERS
};
