const crypto = require('crypto');

class OutgoingWebhooks {
  constructor() {
    this.endpoints = new Map();
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

  register(name, endpoint) {
    this.endpoints.set(name, {
      ...endpoint,
      secret: endpoint.secret || process.env.WEBHOOK_SECRET || 'default-secret'
    });
  }

  async send(name, payload) {
    const endpoint = this.endpoints.get(name);
    if (!endpoint) {
      throw new Error(`No endpoint registered: ${name}`);
    }

    const body = JSON.stringify(payload);
    const signature = this.sign(body, endpoint.secret);

    let attempt = 0;
    while (attempt < this.config.maxRetries) {
      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature
          },
          body
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return { success: true, status: response.status };
      } catch (error) {
        attempt++;
        if (attempt >= this.config.maxRetries) {
          return { success: false, error: error.message };
        }
        await this.delay(this.config.retryDelay * attempt);
      }
    }
  }

  sign(body, secret) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = OutgoingWebhooks;
