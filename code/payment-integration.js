/**
 * Payment Processing Module for Bots.Business Integration Strategy Framework
 * 
 * Handles Stripe integration, PayPal integration, transaction tracking,
 * and refund handling.
 * 
 * @module PaymentIntegration
 */

/**
 * Default configuration for payment integration
 * @type {Object}
 */
const PAYMENT_CONFIG = {
  stripe: {
    apiKey: 'sk_test_YOUR_STRIPE_SECRET_KEY',
    webhookSecret: 'whsec_YOUR_STRIPE_WEBHOOK_SECRET',
    apiVersion: '2024-06-20'
  },
  paypal: {
    clientId: 'YOUR_PAYPAL_CLIENT_ID',
    clientSecret: 'YOUR_PAYPAL_CLIENT_SECRET',
    mode: 'sandbox',
    apiBaseUrl: 'https://api-m.sandbox.paypal.com'
  },
  default: {
    currency: 'USD',
    retryAttempts: 3,
    retryDelay: 1000,
    refundWindowDays: 30
  },
  tracking: {
    logAllTransactions: true,
    storePaymentMethods: false
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
 * Makes an HTTP request with retry logic
 * @private
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {Object} [body] - Request body
 * @param {Object} config - Configuration options
 * @returns {Promise<Object>} Response data
 */
async function requestWithRetry(method, url, body, config) {
  const { retryAttempts, retryDelay, headers = {}, authHeader } = config;
  let lastError;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const requestHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers
      };

      if (authHeader) {
        requestHeaders['Authorization'] = authHeader;
      }

      let response;
      if (method === 'GET') {
        response = HTTP.get(url, { headers: requestHeaders });
      } else if (method === 'POST') {
        response = HTTP.post(url, JSON.stringify(body), { headers: requestHeaders });
      } else if (method === 'PUT') {
        response = HTTP.put(url, JSON.stringify(body), { headers: requestHeaders });
      } else if (method === 'DELETE') {
        response = HTTP.delete(url, { headers: requestHeaders });
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

  throw lastError || new Error('Payment request failed after all retries');
}

/**
 * Creates a Stripe payment intent
 * @param {number} amount - Amount in smallest currency unit (e.g., cents)
 * @param {string} currency - Currency code (default: USD)
 * @param {Object} [metadata] - Additional metadata
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Payment intent or null
 */
async function createStripePaymentIntent(amount, currency, metadata, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const stripeCfg = cfg.stripe;

  try {
    const payload = {
      amount: Math.round(amount),
      currency: currency || cfg.default.currency,
      automatic_payment_methods: { enabled: true },
      metadata: metadata || {}
    };

    const response = await requestWithRetry(
      'POST',
      'https://api.stripe.com/v1/payment_intents',
      payload,
      {
        retryAttempts: cfg.default.retryAttempts,
        retryDelay: cfg.default.retryDelay,
        authHeader: `Bearer ${stripeCfg.apiKey}`
      }
    );

    if (cfg.tracking.logAllTransactions) {
      logTransaction({
        type: 'payment_intent_created',
        provider: 'stripe',
        amount: payload.amount,
        currency: payload.currency,
        paymentId: response.id,
        status: response.status,
        metadata
      });
    }

    console.log(`Created Stripe payment intent: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Failed to create Stripe payment intent:', error.message);
    return null;
  }
}

/**
 * Confirms a Stripe payment
 * @param {string} paymentIntentId - Payment intent ID
 * @param {string} paymentMethodId - Payment method ID
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Confirmed payment or null
 */
async function confirmStripePayment(paymentIntentId, paymentMethodId, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const stripeCfg = cfg.stripe;

  try {
    const payload = {
      payment_method: paymentMethodId
    };

    const response = await requestWithRetry(
      'POST',
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`,
      payload,
      {
        retryAttempts: cfg.default.retryAttempts,
        retryDelay: cfg.default.retryDelay,
        authHeader: `Bearer ${stripeCfg.apiKey}`
      }
    );

    if (response.status === 'succeeded') {
      logTransaction({
        type: 'payment_completed',
        provider: 'stripe',
        amount: response.amount,
        currency: response.currency,
        paymentId: response.id,
        status: 'succeeded'
      });
    }

    return response;
  } catch (error) {
    console.error('Failed to confirm Stripe payment:', error.message);
    return null;
  }
}

/**
 * Refunds a Stripe payment
 * @param {string} paymentIntentId - Payment intent ID
 * @param {number} [amount] - Amount to refund (null for full refund)
 * @param {string} [reason] - Reason for refund
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Refund object or null
 */
async function refundStripePayment(paymentIntentId, amount, reason, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const stripeCfg = cfg.stripe;

  try {
    const payload = {
      payment_intent: paymentIntentId
    };

    if (amount !== undefined && amount !== null) {
      payload.amount = Math.round(amount);
    }

    if (reason) {
      payload.reason = reason;
    }

    const response = await requestWithRetry(
      'POST',
      'https://api.stripe.com/v1/refunds',
      payload,
      {
        retryAttempts: cfg.default.retryAttempts,
        retryDelay: cfg.default.retryDelay,
        authHeader: `Bearer ${stripeCfg.apiKey}`
      }
    );

    logTransaction({
      type: 'payment_refunded',
      provider: 'stripe',
      amount: response.amount,
      currency: response.currency,
      paymentId: response.payment_intent,
      refundId: response.id,
      status: response.status,
      reason
    });

    console.log(`Refunded Stripe payment: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Failed to refund Stripe payment:', error.message);
    return null;
  }
}

/**
 * Gets PayPal access token
 * @private
 * @param {Object} paypalCfg - PayPal configuration
 * @returns {Promise<string|null>} Access token or null
 */
async function getPayPalAccessToken(paypalCfg) {
  try {
    const auth = `${paypalCfg.clientId}:${paypalCfg.clientSecret}`;
    const encodedAuth = auth.replace(/:/g, ':').split(':').map(encodeURIComponent).join(':');

    const response = HTTP.post(
      `${paypalCfg.apiBaseUrl}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.access_token || null;
  } catch (error) {
    console.error('Failed to get PayPal access token:', error.message);
    return null;
  }
}

/**
 * Creates a PayPal order
 * @param {number} amount - Amount
 * @param {string} currency - Currency code
 * @param {Object} [metadata] - Additional metadata
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Order object or null
 */
async function createPayPalOrder(amount, currency, metadata, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const paypalCfg = cfg.paypal;

  try {
    const accessToken = await getPayPalAccessToken(paypalCfg);
    if (!accessToken) {
      throw new Error('Failed to obtain PayPal access token');
    }

    const payload = {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency || cfg.default.currency,
          value: amount.toFixed(2)
        }
      }]
    };

    const response = await requestWithRetry(
      'POST',
      `${paypalCfg.apiBaseUrl}/v2/checkout/orders`,
      payload,
      {
        retryAttempts: cfg.default.retryAttempts,
        retryDelay: cfg.default.retryDelay,
        authHeader: `Bearer ${accessToken}`
      }
    );

    if (cfg.tracking.logAllTransactions) {
      logTransaction({
        type: 'paypal_order_created',
        provider: 'paypal',
        amount: amount,
        currency: currency || cfg.default.currency,
        paymentId: response.id,
        status: response.status,
        metadata
      });
    }

    console.log(`Created PayPal order: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Failed to create PayPal order:', error.message);
    return null;
  }
}

/**
 * Captures a PayPal order
 * @param {string} orderId - PayPal order ID
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Captured order or null
 */
async function capturePayPalOrder(orderId, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const paypalCfg = cfg.paypal;

  try {
    const accessToken = await getPayPalAccessToken(paypalCfg);
    if (!accessToken) {
      throw new Error('Failed to obtain PayPal access token');
    }

    const response = await requestWithRetry(
      'POST',
      `${paypalCfg.apiBaseUrl}/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        retryAttempts: cfg.default.retryAttempts,
        retryDelay: cfg.default.retryDelay,
        authHeader: `Bearer ${accessToken}`
      }
    );

    if (response.status === 'COMPLETED') {
      logTransaction({
        type: 'payment_completed',
        provider: 'paypal',
        amount: response.purchase_units[0].payments.captures[0].amount.value,
        currency: response.purchase_units[0].payments.captures[0].amount.currency_code,
        paymentId: response.id,
        status: 'COMPLETED'
      });
    }

    console.log(`Captured PayPal order: ${orderId}`);
    return response;
  } catch (error) {
    console.error('Failed to capture PayPal order:', error.message);
    return null;
  }
}

/**
 * Refunds a PayPal payment
 * @param {string} captureId - PayPal capture ID
 * @param {number} [amount] - Amount to refund (null for full refund)
 * @param {string} [currency] - Currency code
 * @param {string} [reason] - Reason for refund
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object|null>} Refund object or null
 */
async function refundPayPalPayment(captureId, amount, currency, reason, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const paypalCfg = cfg.paypal;

  try {
    const accessToken = await getPayPalAccessToken(paypalCfg);
    if (!accessToken) {
      throw new Error('Failed to obtain PayPal access token');
    }

    const payload = {};
    if (amount !== undefined && amount !== null) {
      payload.amount = {
        value: amount.toFixed(2),
        currency_code: currency || cfg.default.currency
      };
    }

    if (reason) {
      payload.reason = reason;
    }

    const response = await requestWithRetry(
      'POST',
      `${paypalCfg.apiBaseUrl}/v2/payments/captures/${captureId}/refund`,
      payload,
      {
        retryAttempts: cfg.default.retryAttempts,
        retryDelay: cfg.default.retryDelay,
        authHeader: `Bearer ${accessToken}`
      }
    );

    logTransaction({
      type: 'payment_refunded',
      provider: 'paypal',
      amount: response.amount ? response.amount.value : amount,
      currency: response.amount ? response.amount.currency_code : (currency || cfg.default.currency),
      paymentId: captureId,
      refundId: response.id,
      status: response.status,
      reason
    });

    console.log(`Refunded PayPal payment: ${response.id}`);
    return response;
  } catch (error) {
    console.error('Failed to refund PayPal payment:', error.message);
    return null;
  }
}

/**
 * Logs a payment transaction
 * @private
 * @param {Object} transaction - Transaction data
 * @returns {boolean} Logging success
 */
function logTransaction(transaction) {
  try {
    const logEntry = {
      ...transaction,
      timestamp: new Date().toISOString(),
      loggedAt: Date.now()
    };

    Storage.put(`payment_txn_${transaction.paymentId}_${Date.now()}`, logEntry);
    console.log(`Transaction logged: ${transaction.type} - ${transaction.provider} - ${transaction.amount}`);
    return true;
  } catch (error) {
    console.error('Failed to log transaction:', error.message);
    return false;
  }
}

/**
 * Gets payment transaction history
 * @param {string} [userId] - Filter by user ID
 * @param {string} [provider] - Filter by provider (stripe/paypal)
 * @param {string} [status] - Filter by status
 * @param {Object} [config] - Configuration overrides
 * @returns {Array} Transaction history
 */
function getTransactionHistory(userId, provider, status, config = {}) {
  try {
    const keys = Storage.keys('payment_txn_');
    const transactions = [];

    for (const key of keys) {
      const txn = Storage.get(key);
      if (!txn) continue;

      let matches = true;
      if (userId && txn.userId !== userId) matches = false;
      if (provider && txn.provider !== provider) matches = false;
      if (status && txn.status !== status) matches = false;

      if (matches) {
        transactions.push(txn);
      }
    }

    return transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (error) {
    console.error('Failed to get transaction history:', error.message);
    return [];
  }
}

/**
 * Processes a webhook event from payment provider
 * @param {string} provider - Payment provider (stripe/paypal)
 * @param {Object} event - Event payload
 * @param {Object} [config] - Configuration overrides
 * @returns {Promise<Object>} Processing result
 */
async function processPaymentWebhook(provider, event, config = {}) {
  const cfg = { ...PAYMENT_CONFIG, ...config };
  const result = { success: false, eventType: event.type || 'unknown', processed: false };

  try {
    if (provider === 'stripe') {
      result = await processStripeWebhook(event, cfg);
    } else if (provider === 'paypal') {
      result = await processPayPalWebhook(event, cfg);
    } else {
      result.error = `Unsupported payment provider: ${provider}`;
    }

    return result;
  } catch (error) {
    result.error = error.message;
    console.error(`Failed to process ${provider} webhook:`, error.message);
    return result;
  }
}

/**
 * Processes Stripe webhook event
 * @private
 * @param {Object} event - Stripe event
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} Processing result
 */
async function processStripeWebhook(event, config) {
  const result = { success: false, eventType: event.type, processed: false };

  switch (event.type) {
    case 'payment_intent.succeeded':
      logTransaction({
        type: 'payment_completed',
        provider: 'stripe',
        amount: event.data.object.amount,
        currency: event.data.object.currency,
        paymentId: event.data.object.id,
        status: 'succeeded'
      });
      result.processed = true;
      result.success = true;
      break;

    case 'payment_intent.payment_failed':
      logTransaction({
        type: 'payment_failed',
        provider: 'stripe',
        amount: event.data.object.amount,
        currency: event.data.object.currency,
        paymentId: event.data.object.id,
        status: 'failed'
      });
      result.processed = true;
      result.success = true;
      break;

    case 'charge.refunded':
      logTransaction({
        type: 'payment_refunded',
        provider: 'stripe',
        amount: event.data.object.amount_refunded,
        currency: event.data.object.currency,
        paymentId: event.data.object.payment_intent,
        refundId: event.data.object.id,
        status: 'refunded'
      });
      result.processed = true;
      result.success = true;
      break;

    default:
      console.warn(`Unhandled Stripe event type: ${event.type}`);
  }

  return result;
}

/**
 * Processes PayPal webhook event
 * @private
 * @param {Object} event - PayPal event
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} Processing result
 */
async function processPayPalWebhook(event, config) {
  const result = { success: false, eventType: event.event_type, processed: false };

  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      const capture = event.resource;
      logTransaction({
        type: 'payment_completed',
        provider: 'paypal',
        amount: capture.amount.value,
        currency: capture.amount.currency_code,
        paymentId: capture.id,
        status: 'COMPLETED'
      });
      result.processed = true;
      result.success = true;
      break;

    case 'PAYMENT.CAPTURE.DENIED':
      logTransaction({
        type: 'payment_failed',
        provider: 'paypal',
        paymentId: event.resource.id,
        status: 'DENIED'
      });
      result.processed = true;
      result.success = true;
      break;

    case 'PAYMENT.CAPTURE.REFUNDED':
      const refund = event.resource;
      logTransaction({
        type: 'payment_refunded',
        provider: 'paypal',
        amount: refund.amount.value,
        currency: refund.amount.currency_code,
        paymentId: refund.id,
        status: 'REFUNDED'
      });
      result.processed = true;
      result.success = true;
      break;

    default:
      console.warn(`Unhandled PayPal event type: ${event.event_type}`);
  }

  return result;
}

/**
 * Validates payment amount
 * @param {number} amount - Amount to validate
 * @param {string} currency - Currency code
 * @returns {Object} Validation result
 */
function validatePaymentAmount(amount, currency) {
  const result = { valid: false, error: null };

  if (typeof amount !== 'number' || amount <= 0) {
    result.error = 'Amount must be a positive number';
    return result;
  }

  if (typeof currency !== 'string' || currency.length !== 3) {
    result.error = 'Currency must be a 3-letter ISO code';
    return result;
  }

  const supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
  if (!supportedCurrencies.includes(currency.toUpperCase())) {
    result.error = `Unsupported currency: ${currency}`;
    return result;
  }

  result.valid = true;
  return result;
}

module.exports = {
  createStripePaymentIntent,
  confirmStripePayment,
  refundStripePayment,
  createPayPalOrder,
  capturePayPalOrder,
  refundPayPalPayment,
  processPaymentWebhook,
  getTransactionHistory,
  validatePaymentAmount,
  logTransaction,
  PAYMENT_CONFIG
};
