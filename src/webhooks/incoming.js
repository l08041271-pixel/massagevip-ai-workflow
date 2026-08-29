const crypto = require('crypto');

class IncomingWebhooks {
  constructor() {
    this.handlers = new Map();
    this.config = {};
  }

  async initialize(config) {
    this.config = {
      timeout: config.timeout || 5000,
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      verifySignature: config.verifySignature !== false
    };
  }

  register(eventType, handler) {
    this.handlers.set(eventType, handler);
  }

  async handle(eventType, payload, headers = {}) {
    const handler = this.handlers.get(eventType);
    if (!handler) {
      throw new Error(`No handler registered for event type: ${eventType}`);
    }

    if (this.config.verifySignature) {
      const signature = headers['x-signature'] || headers['X-Signature'];
      if (!signature) {
        throw new Error('Missing signature header');
      }
      const isValid = this.verifySignature(JSON.stringify(payload), signature);
      if (!isValid) {
        throw new Error('Invalid signature');
      }
    }

    return handler(payload);
  }

  verifySignature(payload, signature) {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET || 'default-secret')
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}

module.exports = IncomingWebhooks;
