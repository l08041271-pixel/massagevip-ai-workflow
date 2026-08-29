const SalesforceIntegration = require('./salesforce');
const HubspotIntegration = require('./hubspot');

class CRMRegistry {
  constructor() {
    this.integrations = new Map();
  }

  register(name, integration) {
    this.integrations.set(name, integration);
  }

  get(name) {
    return this.integrations.get(name);
  }

  list() {
    return Array.from(this.integrations.keys());
  }

  async initialize(config) {
    for (const [name, integration] of this.integrations) {
      if (config.providers?.includes(name)) {
        await integration.initialize(config[name] || {});
      }
    }
  }
}

module.exports = CRMRegistry;
