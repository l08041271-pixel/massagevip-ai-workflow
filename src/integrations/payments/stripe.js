const Stripe = require('stripe');
const ApiClient = require('../../core/client');

class StripeIntegration {
  constructor() {
    this.client = null;
    this.stripe = null;
    this.name = 'stripe';
  }

  async initialize(config) {
    if (config.secretKey) {
      this.stripe = Stripe(config.secretKey, {
        apiVersion: config.apiVersion || '2024-06-20'
      });
    }
    this.client = new ApiClient({
      baseURL: 'https://api.stripe.com/v1',
      timeout: 30000,
      auth: { apiKey: config.secretKey }
    });
    console.log(`Stripe integration initialized`);
  }

  async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    return this.stripe.paymentIntents.create({
      amount,
      currency,
      metadata
    });
  }

  async confirmPaymentIntent(paymentIntentId) {
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    return this.stripe.paymentIntents.confirm(paymentIntentId);
  }

  async createCustomer(email, name, metadata = {}) {
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    return this.stripe.customers.create({
      email,
      name,
      metadata
    });
  }

  async createSubscription(customerId, priceId) {
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    return this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }]
    });
  }

  async createRefund(paymentIntentId, amount = null) {
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    const params = { payment_intent: paymentIntentId };
    if (amount) params.amount = amount;
    return this.stripe.refunds.create(params);
  }

  async handleWebhook(payload, signature, secret) {
    if (!this.stripe) {
      throw new Error('Stripe client not initialized');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}

module.exports = new StripeIntegration();
