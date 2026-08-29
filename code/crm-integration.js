/**
 * CRM Integration Module for Bots.Business Integration Strategy Framework
 * 
 * Handles synchronization between the bot and external CRM systems.
 * Supports contact lookup, update, lead scoring, and retry logic.
 * 
 * @module CRMIntegration
 */

/**
 * Default configuration for CRM integration
 * @type {Object}
 */
const CRM_CONFIG = {
  apiUrl: 'https://api.yourcrm.com/v1',
  apiKey: 'YOUR_CRM_API_KEY',
  retryAttempts: 3,
  retryDelay: 1000,
  leadScoring: {
    weights: {
      messageCount: 10,
      commandUsage: 5,
      referralSource: 20,
      lastActiveDays: 1,
      subscriptionStatus: 50
    },
    thresholds: {
      cold: 0,
      warm: 40,
      hot: 80
    }
  }
};

/**
 * Normalizes user data for CRM sync
 * @private
 * @param {Object} userData - Raw user data from the bot
 * @returns {Object} Normalized user data
 */
function normalizeUserData(userData) {
  return {
    externalId: String(userData.id || ''),
    firstName: userData.first_name || '',
    lastName: userData.last_name || '',
    username: userData.username || '',
    phone: userData.phone || '',
    languageCode: userData.language_code || 'en',
    isBot: !!userData.is_bot,
    source: userData.source || 'telegram',
    platform: userData.platform || 'telegram',
    tags: Array.isArray(userData.tags) ? userData.tags : [],
    customFields: userData.custom_fields || {},
    metadata: {
      createdAt: userData.created_at || new Date().toISOString(),
      lastActive: userData.last_active || new Date().toISOString(),
      messageCount: userData.message_count || 0,
      commandUsage: userData.command_usage || 0
    }
  };
}

/**
 * Calculates lead score based on user activity and engagement
 * @private
 * @param {Object} userData - Normalized user data
 * @param {Object} weights - Scoring weights
 * @returns {number} Lead score (0-100)
 */
function calculateLeadScore(userData, weights) {
  let score = 0;
  const now = new Date();
  const lastActive = new Date(userData.metadata.lastActive);
  const daysSinceActive = Math.floor((now - lastActive) / (1000 * 60 * 60 * 24));

  score += (userData.metadata.messageCount || 0) * weights.messageCount;
  score += (userData.metadata.commandUsage || 0) * weights.commandUsage;
  score += daysSinceActive < 7 ? weights.lastActiveDays * (7 - daysSinceActive) : 0;
  score += userData.customFields.referralSource ? weights.referralSource : 0;
  score += userData.customFields.isSubscribed ? weights.subscriptionStatus : 0;

  return Math.min(Math.max(score, 0), 100);
}

/**
 * Determines lead status from score
 * @private
 * @param {number} score - Lead score
 * @param {Object} thresholds - Score thresholds
 * @returns {string} Lead status
 */
function getLeadStatus(score, thresholds) {
  if (score >= thresholds.hot) return 'hot';
  if (score >= thresholds.warm) return 'warm';
  return 'cold';
}

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
 * Makes an HTTP request with retry logic
 * @private
 * @param {string} method - HTTP method (GET, POST, PUT, PATCH)
 * @param {string} url - Request URL
 * @param {Object} [body] - Request body
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} Response data
 */
async function requestWithRetry(method, url, body, config) {
  const { retryAttempts, retryDelay, headers = {} } = config;
  let lastError;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const defaultHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...headers
      };

      let response;
      if (method === 'GET') {
        response = HTTP.get(url, { headers: defaultHeaders });
      } else if (method === 'PATCH') {
        response = HTTP.patch(url, JSON.stringify(body), { headers: defaultHeaders });
      } else if (method === 'POST') {
        response = HTTP.post(url, JSON.stringify(body), { headers: defaultHeaders });
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }

      if (response && response.error) {
        throw new Error(response.error || 'CRM API error');
      }

      return response || {};
    } catch (error) {
      lastError = error;
      if (attempt < retryAttempts - 1) {
        await delay(retryDelay * Math.pow(2, attempt));
      }
    }
  }

  throw lastError || new Error('CRM request failed after all retries');
}

/**
 * Looks up a contact in the CRM by external ID
 * @param {string} externalId - External user ID
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Contact object or null
 */
async function findContact(externalId, config = {}) {
  const cfg = { ...CRM_CONFIG, ...config };
  try {
    const response = await requestWithRetry(
      'GET',
      `${cfg.apiUrl}/contacts?external_id=${encodeURIComponent(externalId)}`,
      null,
      cfg
    );
    return response.data && response.data.length > 0 ? response.data[0] : null;
  } catch (error) {
    console.error(`Failed to find contact with external_id ${externalId}:`, error.message);
    return null;
  }
}

/**
 * Creates or updates a contact in the CRM
 * @param {Object} userData - Raw user data from the bot
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Contact object or null
 */
async function upsertContact(userData, config = {}) {
  const cfg = { ...CRM_CONFIG, ...config };
  const normalizedData = normalizeUserData(userData);
  const leadScore = calculateLeadScore(normalizedData, cfg.leadScoring.weights);
  const leadStatus = getLeadStatus(leadScore, cfg.leadScoring.thresholds);

  const contactPayload = {
    ...normalizedData,
    leadScore,
    leadStatus,
    crmUpdatedAt: new Date().toISOString()
  };

  try {
    const existingContact = await findContact(normalizedData.externalId, cfg);

    if (existingContact) {
      contactPayload.id = existingContact.id;
      contactPayload.crmCreatedAt = existingContact.crmCreatedAt;
      return await requestWithRetry('PATCH', `${cfg.apiUrl}/contacts/${existingContact.id}`, contactPayload, cfg);
    } else {
      contactPayload.crmCreatedAt = new Date().toISOString();
      return await requestWithRetry('POST', `${cfg.apiUrl}/contacts`, contactPayload, cfg);
    }
  } catch (error) {
    console.error(`Failed to upsert contact for user ${normalizedData.externalId}:`, error.message);
    return null;
  }
}

/**
 * Syncs user data to the CRM system
 * @param {Object} userData - Raw user data from the bot
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object>} Sync result with status and contact data
 */
async function syncToCRM(userData, config = {}) {
  const cfg = { ...CRM_CONFIG, ...config };
  const startTime = Date.now();
  const result = {
    success: false,
    action: null,
    contact: null,
    leadScore: null,
    leadStatus: null,
    error: null,
    duration: 0
  };

  try {
    const normalizedData = normalizeUserData(userData);
    const leadScore = calculateLeadScore(normalizedData, cfg.leadScoring.weights);
    const leadStatus = getLeadStatus(leadScore, cfg.leadScoring.thresholds);

    const existingContact = await findContact(normalizedData.externalId, cfg);

    let contact;
    if (existingContact) {
      const updatePayload = { ...normalizedData, leadScore, leadStatus, crmUpdatedAt: new Date().toISOString() };
      updatePayload.id = existingContact.id;
      updatePayload.crmCreatedAt = existingContact.crmCreatedAt;
      contact = await requestWithRetry('PATCH', `${cfg.apiUrl}/contacts/${existingContact.id}`, updatePayload, cfg);
      result.action = 'updated';
    } else {
      const createPayload = { ...normalizedData, leadScore, leadStatus, crmCreatedAt: new Date().toISOString() };
      contact = await requestWithRetry('POST', `${cfg.apiUrl}/contacts`, createPayload, cfg);
      result.action = 'created';
    }

    result.success = true;
    result.contact = contact;
    result.leadScore = leadScore;
    result.leadStatus = leadStatus;
    result.duration = Date.now() - startTime;

    console.log(`CRM sync ${result.action} for user ${normalizedData.externalId}: score=${leadScore}, status=${leadStatus}`);
    return result;
  } catch (error) {
    result.error = error.message;
    result.duration = Date.now() - startTime;
    console.error(`CRM sync failed for user ${userData.id || 'unknown'}:`, error.message);
    return result;
  }
}

/**
 * Updates lead score for a specific contact
 * @param {string} externalId - External user ID
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Updated contact or null
 */
async function updateLeadScore(externalId, config = {}) {
  const cfg = { ...CRM_CONFIG, ...config };
  try {
    const contact = await findContact(externalId, cfg);
    if (!contact) {
      console.warn(`Contact not found for external_id ${externalId}`);
      return null;
    }

    const leadScore = calculateLeadScore(contact, cfg.leadScoring.weights);
    const leadStatus = getLeadStatus(leadScore, cfg.leadScoring.thresholds);

    return await requestWithRetry(
      'PATCH',
      `${cfg.apiUrl}/contacts/${contact.id}`,
      { leadScore, leadStatus, crmUpdatedAt: new Date().toISOString() },
      cfg
    );
  } catch (error) {
    console.error(`Failed to update lead score for ${externalId}:`, error.message);
    return null;
  }
}

/**
 * Batch syncs multiple users to CRM
 * @param {Array<Object>} users - Array of user data objects
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Array>} Array of sync results
 */
async function batchSyncToCRM(users, config = {}) {
  const results = [];
  const batchSize = 10;

  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const batchPromises = batch.map(user => syncToCRM(user, config));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    if (i + batchSize < users.length) {
      await delay(500);
    }
  }

  return results;
}

module.exports = {
  syncToCRM,
  upsertContact,
  findContact,
  updateLeadScore,
  batchSyncToCRM,
  calculateLeadScore,
  normalizeUserData,
  CRM_CONFIG
};
