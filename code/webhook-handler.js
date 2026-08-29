/**
 * Webhook Handler Module for Bots.Business Integration Strategy Framework
 * 
 * Handles incoming webhook processing, outgoing webhook configuration,
 * event-driven triggers, and payload validation.
 * 
 * @module WebhookHandler
 */

/**
 * Default configuration for webhook handling
 * @type {Object}
 */
const WEBHOOK_CONFIG = {
  incoming: {
    secret: 'YOUR_WEBHOOK_SECRET',
    timeout: 5000,
    maxPayloadSize: 1048576,
    allowedOrigins: ['*'],
    rateLimit: {
      windowMs: 60000,
      maxRequests: 100
    }
  },
  outgoing: {
    defaultHeaders: {
      'Content-Type': 'application/json',
      'User-Agent': 'Bots.Business-Webhook/1.0'
    },
    retryAttempts: 3,
    retryDelay: 1000,
    timeout: 10000
  },
  triggers: {
    onUserMessage: true,
    onCommand: true,
    onError: true,
    onPayment: true
  }
};

/**
 * Validates webhook payload signature
 * @private
 * @param {Object} payload - Webhook payload
 * @param {string} signature - Expected signature
 * @param {string} secret - Webhook secret
 * @returns {boolean} Whether signature is valid
 */
function validateSignature(payload, signature, secret) {
  try {
    const crypto = require('crypto');
    const payloadString = JSON.stringify(payload);
    const expectedSignature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
    return signature === expectedSignature;
  } catch (error) {
    console.error('Signature validation error:', error.message);
    return false;
  }
}

/**
 * Validates required fields in payload
 * @private
 * @param {Object} payload - Webhook payload
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {Object} Validation result
 */
function validatePayloadFields(payload, requiredFields) {
  const missing = requiredFields.filter(field => !(field in payload) || payload[field] === undefined || payload[field] === null);
  return {
    valid: missing.length === 0,
    missingFields: missing,
    payload
  };
}

/**
 * Rate limiter for webhook requests
 * @private
 */
const rateLimiter = {
  requests: new Map(),
  
  check(key, windowMs, maxRequests) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const userRequests = this.requests.get(key).filter(time => time > windowStart);
    this.requests.set(key, userRequests);
    
    if (userRequests.length >= maxRequests) {
      return false;
    }
    
    userRequests.push(now);
    return true;
  }
};

/**
 * Processes incoming webhook request
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<void>}
 */
async function handleIncomingWebhook(req, res, config = {}) {
  const cfg = { ...WEBHOOK_CONFIG, ...config };
  
  try {
    const origin = req.headers.origin || req.headers.referer || '';
    if (!cfg.incoming.allowedOrigins.includes('*') && !cfg.incoming.allowedOrigins.includes(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    const clientKey = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    if (!rateLimiter.check(clientKey, cfg.incoming.rateLimit.windowMs, cfg.incoming.rateLimit.maxRequests)) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    let payload;
    if (typeof req.body === 'string') {
      try {
        payload = JSON.parse(req.body);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }
    } else if (typeof req.body === 'object' && req.body !== null) {
      payload = req.body;
    } else {
      return res.status(400).json({ error: 'Empty payload' });
    }

    const signature = req.headers['x-webhook-signature'] || req.headers['x-hub-signature-256'] || '';
    if (cfg.incoming.secret && !validateSignature(payload, signature, cfg.incoming.secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const requiredFields = ['event', 'timestamp', 'data'];
    const validation = validatePayloadFields(payload, requiredFields);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missing: validation.missingFields 
      });
    }

    const eventAge = Date.now() - new Date(payload.timestamp).getTime();
    if (eventAge > cfg.incoming.timeout) {
      return res.status(400).json({ error: 'Event timestamp too old' });
    }

    await processWebhookEvent(payload, cfg);

    return res.status(200).json({ success: true, eventId: payload.eventId || generateEventId() });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Processes webhook event based on event type
 * @private
 * @param {Object} payload - Validated webhook payload
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} Processing result
 */
async function processWebhookEvent(payload, config) {
  const { event, data } = payload;
  const result = { event, processed: false, timestamp: new Date().toISOString() };

  try {
    switch (event) {
      case 'user.message':
        if (config.triggers.onUserMessage) {
          result.data = await handleUserMessageEvent(data);
        }
        break;

      case 'command.executed':
        if (config.triggers.onCommand) {
          result.data = await handleCommandEvent(data);
        }
        break;

      case 'payment.completed':
      case 'payment.failed':
        if (config.triggers.onPayment) {
          result.data = await handlePaymentEvent(event, data);
        }
        break;

      case 'error.occurred':
        if (config.triggers.onError) {
          result.data = await handleErrorEvent(data);
        }
        break;

      default:
        console.warn(`Unhandled webhook event type: ${event}`);
        result.data = { message: 'Event received but not processed' };
    }

    result.processed = true;
    console.log(`Processed webhook event: ${event}`);
    return result;
  } catch (error) {
    console.error(`Failed to process webhook event ${event}:`, error.message);
    result.error = error.message;
    return result;
  }
}

/**
 * Handles user message event
 * @private
 * @param {Object} data - Event data
 * @returns {Promise<Object>} Processing result
 */
async function handleUserMessageEvent(data) {
  return {
    userId: data.userId,
    messageId: data.messageId,
    messageLength: data.message ? data.message.length : 0,
    processedAt: new Date().toISOString()
  };
}

/**
 * Handles command executed event
 * @private
 * @param {Object} data - Event data
 * @returns {Promise<Object>} Processing result
 */
async function handleCommandEvent(data) {
  return {
    command: data.command,
    userId: data.userId,
    success: data.success,
    executionTime: data.executionTime,
    processedAt: new Date().toISOString()
  };
}

/**
 * Handles payment event
 * @private
 * @param {string} eventType - Payment event type
 * @param {Object} data - Event data
 * @returns {Promise<Object>} Processing result
 */
async function handlePaymentEvent(eventType, data) {
  return {
    eventType,
    transactionId: data.transactionId,
    amount: data.amount,
    currency: data.currency,
    status: eventType.split('.')[1],
    processedAt: new Date().toISOString()
  };
}

/**
 * Handles error event
 * @private
 * @param {Object} data - Event data
 * @returns {Promise<Object>} Processing result
 */
async function handleErrorEvent(data) {
  return {
    errorType: data.errorType,
    errorMessage: data.errorMessage,
    stackTrace: data.stackTrace,
    severity: data.severity || 'medium',
    processedAt: new Date().toISOString()
  };
}

/**
 * Generates unique event ID
 * @private
 * @returns {string} Event ID
 */
function generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sends outgoing webhook
 * @param {string} url - Target URL
 * @param {Object} payload - Webhook payload
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object>} Webhook response
 */
async function sendWebhook(url, payload, config = {}) {
  const cfg = { ...WEBHOOK_CONFIG.outgoing, ...config };
  const startTime = Date.now();

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': payload.event || 'generic',
      'X-Webhook-Timestamp': new Date().toISOString(),
      ...(cfg.defaultHeaders || {})
    };

    if (cfg.secret) {
      const crypto = require('crypto');
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', cfg.secret).update(payloadString).digest('hex');
      headers['X-Webhook-Signature'] = signature;
    }

    let response;
    for (let attempt = 0; attempt < cfg.retryAttempts; attempt++) {
      try {
        response = HTTP.post(url, JSON.stringify(payload), { headers });
        if (response && response.status >= 200 && response.status < 300) {
          break;
        }
      } catch (error) {
        if (attempt < cfg.retryAttempts - 1) {
          await delay(cfg.retryDelay * Math.pow(2, attempt));
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Webhook sent to ${url}: status=${response ? response.status : 'failed'}, duration=${duration}ms`);

    return {
      success: response && response.status >= 200 && response.status < 300,
      status: response ? response.status : null,
      body: response,
      duration
    };
  } catch (error) {
    console.error(`Webhook failed for ${url}:`, error.message);
    return {
      success: false,
      status: null,
      error: error.message,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Registers event-driven trigger
 * @param {string} eventType - Type of event to trigger on
 * @param {Function} handler - Handler function
 * @param {Object} [config] - Configuration overrides
 * @returns {boolean} Registration success
 */
function registerTrigger(eventType, handler, config = {}) {
  const cfg = { ...WEBHOOK_CONFIG.triggers, ...config };
  
  if (!cfg[eventType]) {
    console.warn(`Trigger type ${eventType} is not enabled in configuration`);
    return false;
  }

  try {
    Storage.put(`webhook_trigger_${eventType}`, {
      handler: handler.toString(),
      config: cfg,
      registeredAt: new Date().toISOString()
    });
    console.log(`Registered webhook trigger for: ${eventType}`);
    return true;
  } catch (error) {
    console.error(`Failed to register trigger for ${eventType}:`, error.message);
    return false;
  }
}

/**
 * Triggers registered webhook
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object>} Trigger result
 */
async function triggerWebhook(eventType, data, config = {}) {
  const cfg = { ...WEBHOOK_CONFIG, ...config };
  const triggerKey = `webhook_trigger_${eventType}`;
  
  try {
    const trigger = Storage.get(triggerKey);
    if (!trigger) {
      console.warn(`No trigger registered for: ${eventType}`);
      return { success: false, error: 'No trigger registered' };
    }

    const handler = new Function('return ' + trigger.handler)();
    const result = await handler(data);
    
    console.log(`Triggered webhook: ${eventType}`);
    return { success: true, result };
  } catch (error) {
    console.error(`Failed to trigger webhook ${eventType}:`, error.message);
    return { success: false, error: error.message };
  }
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

module.exports = {
  handleIncomingWebhook,
  sendWebhook,
  registerTrigger,
  triggerWebhook,
  validateSignature,
  validatePayloadFields,
  WEBHOOK_CONFIG
};
