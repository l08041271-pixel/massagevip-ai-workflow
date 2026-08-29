const IncomingWebhooks = require('./incoming');
const OutgoingWebhooks = require('./outgoing');

class WebhooksModule {
  constructor() {
    this.incoming = new IncomingWebhooks();
    this.outgoing = new OutgoingWebhooks();
  }

  async initialize(config) {
    await this.incoming.initialize(config.incoming || {});
    await this.outgoing.initialize(config.outgoing || {});
  }
}

module.exports = WebhooksModule;
