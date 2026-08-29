const Logger = require('./logger');
const Metrics = require('./metrics');
const Alerts = require('./alerts');

class MonitoringModule {
  constructor() {
    this.logger = new Logger();
    this.metrics = new Metrics();
    this.alerts = new Alerts();
  }

  async initialize(config) {
    await this.logger.initialize(config);
    if (config.metrics?.enabled) {
      await this.metrics.initialize(config.metrics);
    }
    if (config.alerts?.enabled) {
      await this.alerts.initialize(config.alerts);
    }
  }
}

module.exports = MonitoringModule;
