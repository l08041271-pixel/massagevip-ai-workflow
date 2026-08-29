/**
 * Analytics Integration Module for Bots.Business Integration Strategy Framework
 * 
 * Handles Google Analytics connection, bot usage tracking, event tracking,
 * and custom metrics collection.
 * 
 * @module AnalyticsIntegration
 */

/**
 * Default configuration for analytics integration
 * @type {Object}
 */
const ANALYTICS_CONFIG = {
  googleAnalytics: {
    measurementId: 'G-XXXXXXXXXX',
    apiSecret: 'YOUR_API_SECRET',
    clientId: 'YOUR_CLIENT_ID'
  },
  tracking: {
    enabled: true,
    batchSize: 20,
    flushInterval: 30000,
    debug: false
  },
  events: {
    commandExecuted: { category: 'Bot', action: 'Command Executed', label: null },
    userMessage: { category: 'Bot', action: 'User Message', label: null },
    userJoined: { category: 'Bot', action: 'User Joined', label: null },
    paymentCompleted: { category: 'Bot', action: 'Payment Completed', label: null },
    errorOccurred: { category: 'Bot', action: 'Error Occurred', label: null },
    featureUsed: { category: 'Bot', action: 'Feature Used', label: null }
  },
  metrics: {
    retentionDays: 30,
    aggregationInterval: 3600000
  }
};

/**
 * Event buffer for batch sending
 * @private
 */
const eventBuffer = {
  events: [],
  flushTimer: null,

  add(event) {
    this.events.push({
      ...event,
      timestamp: new Date().toISOString()
    });
  },

  flush(batchSize) {
    if (this.events.length === 0) return [];

    const batch = this.events.splice(0, batchSize || 20);
    return batch;
  },

  clear() {
    this.events = [];
  },

  count() {
    return this.events.length;
  }
};

/**
 * Initializes the analytics module
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Initialization success
 */
function initAnalytics(config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };

  if (!cfg.tracking.enabled) {
    console.log('Analytics tracking is disabled');
    return false;
  }

  if (eventBuffer.flushTimer) {
    clearInterval(eventBuffer.flushTimer);
  }

  eventBuffer.flushTimer = setInterval(() => {
    const events = eventBuffer.flush(cfg.tracking.batchSize);
    if (events.length > 0) {
      flushEvents(events, cfg);
    }
  }, cfg.tracking.flushInterval);

  if (cfg.tracking.debug) {
    console.log('Analytics initialized with flush interval:', cfg.tracking.flushInterval);
  }

  return true;
}

/**
 * Flushes events to Google Analytics Measurement Protocol
 * @private
 * @param {Array} events - Array of events to flush
 * @param {Object} config - Configuration
 * @returns {Promise<boolean>} Success status
 */
async function flushEvents(events, config) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };

  try {
    const gaEvents = events.map(event => ({
      client_id: event.clientId || cfg.googleAnalytics.clientId,
      events: [{
        name: event.name || event.action || 'generic_event',
        params: {
          event_category: event.category || 'Bot',
          event_label: event.label || '',
          value: event.value || 1,
          session_id: event.sessionId || generateSessionId(),
          engagement_time_msec: event.engagementTime || 100
        }
      }]
    }));

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${cfg.googleAnalytics.measurementId}&api_secret=${cfg.googleAnalytics.apiSecret}`;
    const response = HTTP.post(url, JSON.stringify({ client_id: gaEvents[0].client_id, events: gaEvents[0].events }));

    if (cfg.tracking.debug) {
      console.log(`Flushed ${events.length} events to GA:`, response);
    }

    return !!response;
  } catch (error) {
    console.error('Failed to flush events to Google Analytics:', error.message);
    return false;
  }
}

/**
 * Tracks a custom event
 * @param {string} eventName - Name of the event
 * @param {Object} params - Event parameters
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackEvent(eventName, params = {}, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };

  if (!cfg.tracking.enabled) {
    if (cfg.tracking.debug) {
      console.log(`Analytics disabled, event not tracked: ${eventName}`);
    }
    return false;
  }

  const event = {
    name: eventName,
    category: params.category || 'Bot',
    action: params.action || eventName,
    label: params.label || '',
    value: params.value || 1,
    clientId: params.clientId || cfg.googleAnalytics.clientId,
    sessionId: params.sessionId || generateSessionId(),
    userId: params.userId,
    engagementTime: params.engagementTime || 100,
    customParams: params.customParams || {}
  };

  eventBuffer.add(event);

  if (cfg.tracking.debug) {
    console.log(`Tracked event: ${eventName}`, params);
  }

  return true;
}

/**
 * Tracks bot command usage
 * @param {string} command - Command name
 * @param {Object} userData - User data
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackCommand(command, userData = {}, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const eventConfig = cfg.events.commandExecuted;

  return trackEvent(eventConfig.action, {
    category: eventConfig.category,
    action: eventConfig.action,
    label: command,
    userId: userData.id,
    clientId: generateClientId(userData.id),
    value: 1,
    customParams: {
      command,
      platform: userData.platform || 'telegram',
      userType: userData.isBot ? 'bot' : 'human'
    }
  }, cfg);
}

/**
 * Tracks user message
 * @param {Object} userData - User data
 * @param {string} [messageType] - Type of message
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackUserMessage(userData, messageType = 'text', config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const eventConfig = cfg.events.userMessage;

  return trackEvent(eventConfig.action, {
    category: eventConfig.category,
    action: eventConfig.action,
    label: messageType,
    userId: userData.id,
    clientId: generateClientId(userData.id),
    value: userData.messageLength || 1,
    customParams: {
      messageType,
      platform: userData.platform || 'telegram',
      language: userData.languageCode || 'en'
    }
  }, cfg);
}

/**
 * Tracks user join event
 * @param {Object} userData - User data
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackUserJoin(userData, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const eventConfig = cfg.events.userJoined;

  return trackEvent(eventConfig.action, {
    category: eventConfig.category,
    action: eventConfig.action,
    label: userData.source || 'telegram',
    userId: userData.id,
    clientId: generateClientId(userData.id),
    value: 1,
    customParams: {
      source: userData.source || 'telegram',
      platform: userData.platform || 'telegram',
      referrer: userData.referrer || ''
    }
  }, cfg);
}

/**
 * Tracks payment completion
 * @param {Object} paymentData - Payment data
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackPayment(paymentData, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const eventConfig = cfg.events.paymentCompleted;

  return trackEvent(eventConfig.action, {
    category: eventConfig.category,
    action: eventConfig.action,
    label: paymentData.paymentMethod || 'unknown',
    userId: paymentData.userId,
    clientId: generateClientId(paymentData.userId),
    value: paymentData.amount || 0,
    customParams: {
      transactionId: paymentData.transactionId,
      paymentMethod: paymentData.paymentMethod,
      currency: paymentData.currency || 'USD',
      status: paymentData.status || 'completed'
    }
  }, cfg);
}

/**
 * Tracks error occurrence
 * @param {string} errorType - Type of error
 * @param {string} errorMessage - Error message
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackError(errorType, errorMessage, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const eventConfig = cfg.events.errorOccurred;

  return trackEvent(eventConfig.action, {
    category: eventConfig.category,
    action: eventConfig.action,
    label: errorType,
    value: 1,
    customParams: {
      errorType,
      errorMessage: errorMessage.substring(0, 200)
    }
  }, cfg);
}

/**
 * Tracks feature usage
 * @param {string} feature - Feature name
 * @param {Object} [params] - Additional parameters
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Tracking success
 */
function trackFeature(feature, params = {}, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const eventConfig = cfg.events.featureUsed;

  return trackEvent(eventConfig.action, {
    category: eventConfig.category,
    action: eventConfig.action,
    label: feature,
    userId: params.userId,
    clientId: params.clientId ? generateClientId(params.userId) : cfg.googleAnalytics.clientId,
    value: 1,
    customParams: {
      feature,
      ...params
    }
  }, cfg);
}

/**
 * Generates a client ID from user ID
 * @private
 * @param {string|number} userId - User ID
 * @returns {string} Client ID
 */
function generateClientId(userId) {
  const str = String(userId || 'anonymous');
  return `${str}.${Math.floor(Date.now() / 1000)}`;
}

/**
 * Generates a session ID
 * @private
 * @returns {string} Session ID
 */
function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Collects custom metrics
 * @param {string} metricName - Metric name
 * @param {number} value - Metric value
 * @param {Object} [dimensions] - Metric dimensions
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Collection success
 */
function collectMetric(metricName, value, dimensions = {}, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };

  if (!cfg.tracking.enabled) {
    return false;
  }

  try {
    const metric = {
      name: metricName,
      value,
      dimensions: Object.keys(dimensions).map(key => ({
        name: key,
        value: dimensions[key]
      })),
      timestamp: new Date().toISOString()
    };

    Storage.put(`metric_${metricName}_${Date.now()}`, metric);

    if (cfg.tracking.debug) {
      console.log(`Collected metric: ${metricName}`, metric);
    }

    return true;
  } catch (error) {
    console.error(`Failed to collect metric ${metricName}:`, error.message);
    return false;
  }
}

/**
 * Gets aggregated metrics
 * @param {string} metricName - Metric name
 * @param {number} [hours=24] - Hours to look back
 * @param {Object} [config] - Configuration overrides
 * @returns {Array} Aggregated metrics
 */
function getMetrics(metricName, hours = 24, config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };
  const metrics = [];
  const cutoff = Date.now() - (hours * 3600000);

  try {
    const keys = Storage.keys(`metric_${metricName}_`);
    for (const key of keys) {
      const metric = Storage.get(key);
      if (metric && new Date(metric.timestamp).getTime() >= cutoff) {
        metrics.push(metric);
      }
    }

    return metrics;
  } catch (error) {
    console.error(`Failed to get metrics for ${metricName}:`, error.message);
    return [];
  }
}

/**
 * Shuts down analytics module
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<boolean>} Shutdown success
 */
async function shutdownAnalytics(config = {}) {
  const cfg = { ...ANALYTICS_CONFIG, ...config };

  if (eventBuffer.flushTimer) {
    clearInterval(eventBuffer.flushTimer);
    eventBuffer.flushTimer = null;
  }

  const remainingEvents = eventBuffer.flush(cfg.tracking.batchSize);
  if (remainingEvents.length > 0) {
    await flushEvents(remainingEvents, cfg);
  }

  console.log('Analytics module shut down');
  return true;
}

module.exports = {
  initAnalytics,
  trackEvent,
  trackCommand,
  trackUserMessage,
  trackUserJoin,
  trackPayment,
  trackError,
  trackFeature,
  collectMetric,
  getMetrics,
  shutdownAnalytics,
  flushEvents,
  ANALYTICS_CONFIG
};
