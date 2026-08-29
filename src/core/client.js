const axios = require('axios');
const AuthHandler = require('./auth');

class ApiClient {
  constructor(config) {
    this.config = config;
    this.baseURL = config.baseURL;
    this.timeout = config.timeout || 30000;
    this.retries = config.retries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.authHandler = new AuthHandler(config.auth);
  }

  async request(method, endpoint, data = null, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...this.authHandler.getHeaders()
    };

    const config = {
      method,
      url,
      headers,
      timeout: this.timeout,
      ...options
    };

    if (data) {
      config.data = data;
    }

    let attempt = 0;
    while (attempt < this.retries) {
      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        attempt++;
        if (attempt >= this.retries) {
          throw new Error(`Request failed after ${this.retries} attempts: ${error.message}`);
        }
        await this.delay(this.retryDelay * attempt);
      }
    }
  }

  async get(endpoint, options = {}) {
    return this.request('GET', endpoint, null, options);
  }

  async post(endpoint, data, options = {}) {
    return this.request('POST', endpoint, data, options);
  }

  async put(endpoint, data, options = {}) {
    return this.request('PUT', endpoint, data, options);
  }

  async patch(endpoint, data, options = {}) {
    return this.request('PATCH', endpoint, data, options);
  }

  async delete(endpoint, options = {}) {
    return this.request('DELETE', endpoint, null, options);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ApiClient;
