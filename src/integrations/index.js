const CRMRegistry = require('./crm');
const SheetsRegistry = require('./sheets');
const AnalyticsRegistry = require('./analytics');
const PaymentsRegistry = require('./payments');
const EmailRegistry = require('./email');

const IntegrationRegistry = {
  registries: {
    crm: new CRMRegistry(),
    sheets: new SheetsRegistry(),
    analytics: new AnalyticsRegistry(),
    payments: new PaymentsRegistry(),
    email: new EmailRegistry()
  },

  register(domain, name, integration) {
    if (!this.registries[domain]) {
      throw new Error(`Unknown integration domain: ${domain}`);
    }
    this.registries[domain].register(name, integration);
  },

  get(domain, name) {
    if (!this.registries[domain]) {
      throw new Error(`Unknown integration domain: ${domain}`);
    }
    return this.registries[domain].get(name);
  },

  list(domain) {
    if (domain) {
      return this.registries[domain]?.list() || [];
    }
    const all = {};
    for (const [key, registry] of Object.entries(this.registries)) {
      all[key] = registry.list();
    }
    return all;
  },

  async initialize(config) {
    for (const [domain, registry] of Object.entries(this.registries)) {
      const domainConfig = config[domain];
      if (domainConfig && domainConfig.enabled) {
        await registry.initialize(domainConfig);
      }
    }
  }
};

module.exports = IntegrationRegistry;
