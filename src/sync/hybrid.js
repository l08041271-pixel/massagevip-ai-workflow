const RealtimeSync = require('./realtime');
const BatchSync = require('./batch');

class HybridSync {
  constructor() {
    this.realtime = new RealtimeSync();
    this.batch = new BatchSync();
    this.config = {};
  }

  async initialize(config) {
    this.config = {
      realtime: config.realtime || {},
      batch: config.batch || {}
    };
    await this.realtime.initialize(this.config.realtime);
    await this.batch.initialize(this.config.batch);
  }

  async sync(source, target, data, options = {}) {
    const { priority, mode = 'adaptive' } = options;

    if (mode === 'realtime' || (priority === 'high' && data.length < 100)) {
      return this.realtime.sync(source, target, data, options);
    }

    if (mode === 'batch' || priority === 'low' || data.length >= 100) {
      return this.batch.sync(source, target, data, options);
    }

    const realtimeResult = await this.realtime.sync(source, target, data.slice(0, 50), options);
    const batchResult = await this.batch.sync(source, target, data.slice(50), options);

    return {
      success: true,
      realtime: realtimeResult,
      batch: batchResult
    };
  }
}

module.exports = HybridSync;
