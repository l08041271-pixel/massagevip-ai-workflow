const mixpanel = require('mixpanel');
const ApiClient = require('../../core/client');

class MixpanelIntegration {
  constructor() {
    this.client = null;
    this.name = 'mixpanel';
    this.mixpanelClient = null;
  }

  async initialize(config) {
    if (config.token) {
      this.mixpanelClient = mixpanel.init(config.token, { apiSecret: config.apiSecret });
    }
    this.client = new ApiClient({
      baseURL: 'https://api.mixpanel.com',
      timeout: 30000
    });
    console.log(`Mixpanel integration initialized`);
  }

  async track(eventName, properties = {}) {
    if (!this.mixpanelClient) {
      throw new Error('Mixpanel client not initialized');
    }
    return this.mixpanelClient.track(eventName, properties);
  }

  async identify(userId, properties = {}) {
    if (!this.mixpanelClient) {
      throw new Error('Mixpanel client not initialized');
    }
    return this.mixpanelClient.people.set(userId, properties);
  }

  async alias(alias, original) {
    if (!this.mixpanelClient) {
      throw new Error('Mixpanel client not initialized');
    }
    return this.mixpanelClient.alias(alias, original);
  }

  async getEvent(eventName, filters = {}) {
    throw new Error('getEvent not implemented');
  }

  async export(data) {
    if (!this.mixpanelClient) {
      throw new Error('Mixpanel client not initialized');
    }
    return this.mixpanelClient.export(data);
  }
}

module.exports = new MixpanelIntegration();
