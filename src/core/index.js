const ApiClient = require('./client');
const AuthHandler = require('./auth');
const { generateId, formatTimestamp, sanitizeInput } = require('./utils');

class IntegrationCore {
  constructor(config = {}) {
    this.config = config;
    this.clients = new Map();
    this.authHandler = new AuthHandler(config.auth);
    this.utils = {
      generateId,
      formatTimestamp,
      sanitizeInput
    };
  }

  registerClient(name, client) {
    this.clients.set(name, client);
  }

  getClient(name) {
    return this.clients.get(name);
  }

  async initialize() {
    await this.authHandler.initialize();
  }
}

module.exports = { IntegrationCore, ApiClient, AuthHandler, ...require('./utils') };
