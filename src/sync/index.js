const RealtimeSync = require('./realtime');
const BatchSync = require('./batch');
const HybridSync = require('./hybrid');

class SyncModule {
  constructor() {
    this.strategies = {
      realtime: new RealtimeSync(),
      batch: new BatchSync(),
      hybrid: new HybridSync()
    };
    this.activeStrategy = null;
    this.config = {};
  }

  async initialize(config) {
    this.config = config;
    this.activeStrategy = this.strategies[config.mode] || this.strategies.hybrid;
    await this.activeStrategy.initialize(config);
  }

  async sync(source, target, data, options = {}) {
    if (!this.activeStrategy) {
      throw new Error('Sync module not initialized');
    }
    return this.activeStrategy.sync(source, target, data, options);
  }

  getStrategy() {
    return this.activeStrategy?.constructor.name || 'none';
  }
}

module.exports = SyncModule;
