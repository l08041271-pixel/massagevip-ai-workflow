/**
 * Google Sheets Integration Module for Bots.Business Integration Strategy Framework
 * 
 * Handles real-time synchronization, CSV import/export, command updates from sheets,
 * and automated backup workflows.
 * 
 * @module SheetsIntegration
 */

/**
 * Default configuration for Google Sheets integration
 * @type {Object}
 */
const SHEETS_CONFIG = {
  apiUrl: 'https://sheets.googleapis.com/v4/spreadsheets',
  oauthToken: 'YOUR_OAUTH_TOKEN',
  spreadsheetId: 'YOUR_SPREADSHEET_ID',
  retryAttempts: 3,
  retryDelay: 1000,
  syncInterval: 60000,
  backup: {
    enabled: true,
    maxBackups: 10,
    backupSheetName: 'Backup_History',
    autoBackupInterval: 3600000
  },
  sheets: {
    commands: 'Commands',
    users: 'Users',
    analytics: 'Analytics',
    settings: 'Settings'
  }
};

/**
 * Delays execution for retry logic
 * @private
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parses CSV string to array of objects
 * @private
 * @param {string} csvString - CSV content
 * @param {boolean} [hasHeader=true] - Whether CSV has header row
 * @returns {Array<Object>} Array of row objects
 */
function parseCSV(csvString, hasHeader = true) {
  const lines = csvString.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = hasHeader ? parseCSVLine(lines[0]) : lines[0].split(',').map((_, i) => `col${i}`);
  const rows = [];

  const startIndex = hasHeader ? 1 : 0;
  for (let i = startIndex; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parses a single CSV line handling quoted values
 * @private
 * @param {string} line - CSV line
 * @returns {Array<string>} Parsed values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Converts array of objects to CSV string
 * @private
 * @param {Array<Object>} data - Array of objects
 * @returns {string} CSV string
 */
function convertToCSV(data) {
  if (!Array.isArray(data) || data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(header => {
    const value = String(row[header] || '');
    return value.includes(',') || value.includes('"') || value.includes('\n')
      ? `"${value.replace(/"/g, '""')}"`
      : value;
  }));

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Makes an HTTP request with retry logic
 * @private
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {Object} [body] - Request body
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} Response data
 */
async function requestWithRetry(method, url, body, config) {
  const { retryAttempts, retryDelay } = config;
  let lastError;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const headers = {
        'Authorization': `Bearer ${config.oauthToken}`,
        'Content-Type': 'application/json'
      };

      let response;
      if (method === 'GET') {
        response = HTTP.get(url, { headers });
      } else if (method === 'PUT') {
        response = HTTP.put(url, JSON.stringify(body), { headers });
      } else if (method === 'POST') {
        response = HTTP.post(url, JSON.stringify(body), { headers });
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }

      if (response && response.error) {
        throw new Error(response.error);
      }

      return response || {};
    } catch (error) {
      lastError = error;
      if (attempt < retryAttempts - 1) {
        await delay(retryDelay * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error('Sheets request failed after all retries');
}

/**
 * Reads data from a Google Sheet
 * @param {string} sheetName - Name of the sheet tab
 * @param {string} [range] - A1 notation range (e.g., 'A1:Z100')
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Array<Object>>} Array of row objects
 */
async function readSheet(sheetName, range, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const spreadsheetId = cfg.spreadsheetId;
    const sheetRange = range || `${sheetName}!A:Z`;
    const url = `${cfg.apiUrl}/${spreadsheetId}/values/${encodeURIComponent(sheetRange)}?valueRenderOption=UNFORMATTED_VALUE`;

    const response = await requestWithRetry('GET', url, null, cfg);

    if (!response.values || response.values.length === 0) {
      return [];
    }

    const headers = response.values[0];
    const rows = [];

    for (let i = 1; i < response.values.length; i++) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = response.values[i][index] !== undefined ? String(response.values[i][index]) : '';
      });
      rows.push(row);
    }

    return rows;
  } catch (error) {
    console.error(`Failed to read sheet ${sheetName}:`, error.message);
    return [];
  }
}

/**
 * Writes data to a Google Sheet
 * @param {string} sheetName - Name of the sheet tab
 * @param {Array<Object>} data - Array of objects to write
 * @param {string} [range] - Starting cell for write operation
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<boolean>} Success status
 */
async function writeSheet(sheetName, data, range, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const spreadsheetId = cfg.spreadsheetId;
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    const values = [headers, ...data.map(row => headers.map(h => String(row[h] || '')))];

    const startRow = range ? parseInt(range, 10) : 1;
    const endRow = startRow + values.length - 1;
    const endCol = String.fromCharCode(64 + headers.length);
    const sheetRange = `${sheetName}!A${startRow}:${endCol}${endRow}`;

    const url = `${cfg.apiUrl}/${spreadsheetId}/values/${encodeURIComponent(sheetRange)}?valueInputOption=USER_ENTERED`;

    const response = await requestWithRetry('PUT', url, { values }, cfg);

    if (response && response.updatedCells !== undefined) {
      console.log(`Updated ${response.updatedCells} cells in ${sheetName}`);
      return true;
    }

    return !!response;
  } catch (error) {
    console.error(`Failed to write sheet ${sheetName}:`, error.message);
    return false;
  }
}

/**
 * Appends rows to a Google Sheet
 * @param {string} sheetName - Name of the sheet tab
 * @param {Array<Object>} data - Array of objects to append
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<boolean>} Success status
 */
async function appendToSheet(sheetName, data, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const spreadsheetId = cfg.spreadsheetId;
    const headers = data.length > 0 ? Object.keys(data[0]) : [];
    const values = data.map(row => headers.map(h => String(row[h] || '')));

    const url = `${cfg.apiUrl}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const response = await requestWithRetry('POST', url, { values }, cfg);
    return !!response;
  } catch (error) {
    console.error(`Failed to append to sheet ${sheetName}:`, error.message);
    return false;
  }
}

/**
 * Syncs data from sheet to bot commands
 * @param {string} sheetName - Name of the commands sheet tab
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Array>} Updated commands
 */
async function syncCommandsFromSheet(sheetName, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const commands = await readSheet(sheetName, null, cfg);
    const updatedCommands = [];

    for (const cmd of commands) {
      const payload = {
        command: cmd.command || cmd.name,
        description: cmd.description || '',
        response: cmd.response || cmd.message || '',
        enabled: cmd.enabled !== 'false',
        triggerType: cmd.trigger_type || 'text',
        category: cmd.category || 'general',
        priority: parseInt(cmd.priority || '0', 10),
        tags: cmd.tags ? cmd.tags.split(',').map(t => t.trim()) : []
      };

      const url = `${cfg.apiUrl}/${cfg.spreadsheetId}/values/${encodeURIComponent(sheetName)}:batchUpdate`;
      const response = await requestWithRetry('POST', url, { command: payload }, cfg);
      updatedCommands.push({ ...payload, sheetResponse: response });
    }

    console.log(`Synced ${updatedCommands.length} commands from sheet`);
    return updatedCommands;
  } catch (error) {
    console.error(`Failed to sync commands from sheet ${sheetName}:`, error.message);
    return [];
  }
}

/**
 * Imports CSV data into a Google Sheet
 * @param {string} sheetName - Name of the sheet tab
 * @param {string} csvContent - CSV string content
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<boolean>} Success status
 */
async function importCSVToSheet(sheetName, csvContent, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const data = parseCSV(csvContent);
    if (data.length === 0) {
      console.warn('No data found in CSV');
      return false;
    }

    return await writeSheet(sheetName, data, null, cfg);
  } catch (error) {
    console.error(`Failed to import CSV to sheet ${sheetName}:`, error.message);
    return false;
  }
}

/**
 * Exports sheet data to CSV
 * @param {string} sheetName - Name of the sheet tab
 * @param {string} [filePath] - Optional file path to save CSV
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<string|null>} CSV string or null on failure
 */
async function exportSheetToCSV(sheetName, filePath, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const data = await readSheet(sheetName, null, cfg);
    const csvString = convertToCSV(data);

    if (filePath) {
      const file = Storage.open(filePath, 'write');
      file.write(csvString);
      file.close();
      console.log(`Exported sheet ${sheetName} to ${filePath}`);
    }

    return csvString;
  } catch (error) {
    console.error(`Failed to export sheet ${sheetName}:`, error.message);
    return null;
  }
}

/**
 * Creates an automated backup of a sheet
 * @param {string} sheetName - Name of the sheet tab to backup
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<boolean>} Success status
 */
async function createBackup(sheetName, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  if (!cfg.backup.enabled) {
    console.log('Backup is disabled in configuration');
    return false;
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupSheetName = `${cfg.backup.backupSheetName}_${timestamp}`;

    const data = await readSheet(sheetName, null, cfg);
    if (data.length === 0) {
      console.warn(`No data to backup for sheet ${sheetName}`);
      return false;
    }

    const headers = Object.keys(data[0]);
    const values = [headers, ...data.map(row => headers.map(h => String(row[h] || '')))];

    const url = `${cfg.apiUrl}/${cfg.spreadsheetId}/values:batchUpdate`;
    const body = {
      valueInputOption: 'USER_ENTERED',
      data: [{
        range: backupSheetName,
        values: values
      }]
    };

    await requestWithRetry('POST', url, body, cfg);
    console.log(`Created backup: ${backupSheetName}`);
    return true;
  } catch (error) {
    console.error(`Failed to create backup for sheet ${sheetName}:`, error.message);
    return false;
  }
}

/**
 * Real-time sync between bot and Google Sheets
 * @param {string} sheetName - Name of the sheet tab
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object>} Sync status
 */
async function realTimeSync(sheetName, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  const result = { success: false, lastSync: null, changes: 0, error: null };

  try {
    const sheetData = await readSheet(sheetName, null, cfg);
    result.changes = sheetData.length;
    result.lastSync = new Date().toISOString();
    result.success = true;

    if (cfg.backup.enabled && cfg.backup.autoBackupInterval) {
      const lastBackup = Storage.get('last_sheets_backup') || 0;
      const now = Date.now();
      if (now - lastBackup >= cfg.backup.autoBackupInterval) {
        await createBackup(sheetName, cfg);
        Storage.put('last_sheets_backup', now);
      }
    }

    return result;
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

/**
 * Updates a single cell in a Google Sheet
 * @param {string} sheetName - Name of the sheet tab
 * @param {string} cell - Cell reference (e.g., 'A1')
 * @param {string} value - Cell value
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<boolean>} Success status
 */
async function updateCell(sheetName, cell, value, config = {}) {
  const cfg = { ...SHEETS_CONFIG, ...config };
  try {
    const spreadsheetId = cfg.spreadsheetId;
    const url = `${cfg.apiUrl}/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!${cell}?valueInputOption=USER_ENTERED`;

    const response = await requestWithRetry('PUT', url, { values: [[value]] }, cfg);
    return !!response;
  } catch (error) {
    console.error(`Failed to update cell ${cell} in sheet ${sheetName}:`, error.message);
    return false;
  }
}

module.exports = {
  readSheet,
  writeSheet,
  appendToSheet,
  syncCommandsFromSheet,
  importCSVToSheet,
  exportSheetToCSV,
  createBackup,
  realTimeSync,
  updateCell,
  parseCSV,
  convertToCSV,
  SHEETS_CONFIG
};
