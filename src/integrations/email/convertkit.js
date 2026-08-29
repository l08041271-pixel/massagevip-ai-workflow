const ApiClient = require('../../core/client');

class ConvertkitIntegration {
  constructor() {
    this.client = null;
    this.name = 'convertkit';
  }

  async initialize(config) {
    this.client = new ApiClient({
      baseURL: 'https://api.convertkit.com/v3',
      timeout: 30000,
      auth: { apiKey: config.apiKey }
    });
    console.log(`ConvertKit integration initialized`);
  }

  async addSubscriberToList(listId, email, fields = {}) {
    throw new Error('addSubscriberToList not implemented');
  }

  async removeSubscriberFromList(listId, email) {
    throw new Error('removeSubscriberFromList not implemented');
  }

  async createTag(name) {
    throw new Error('createTag not implemented');
  }

  async addTagToSubscriber(tagId, email) {
    throw new Error('addTagToSubscriber not implemented');
  }

  async removeTagFromSubscriber(tagId, email) {
    throw new Error('removeTagFromSubscriber not implemented');
  }

  async getSubscriber(email) {
    throw new Error('getSubscriber not implemented');
  }
}

module.exports = new ConvertkitIntegration();
