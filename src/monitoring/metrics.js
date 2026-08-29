const client = require('prom-client');

class Metrics {
  constructor() {
    this.register = new client.Registry();
    this.metrics = {};
  }

  async initialize(config) {
    this.config = config;
    this.setupDefaultMetrics();
  }

  setupDefaultMetrics() {
    this.metrics.httpRequests = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
      registers: [this.register]
    });

    this.metrics.requestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'path'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.register]
    });

    this.metrics.activeConnections = new client.Gauge({
      name: 'active_connections',
      help: 'Number of active connections',
      registers: [this.register]
    });

    this.metrics.integrationCalls = new client.Counter({
      name: 'integration_calls_total',
      help: 'Total integration API calls',
      labelNames: ['integration', 'provider', 'status'],
      registers: [this.register]
    });

    this.metrics.webhookDelivery = new client.Histogram({
      name: 'webhook_delivery_duration_seconds',
      help: 'Webhook delivery duration in seconds',
      labelNames: ['endpoint'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.register]
    });
  }

  incrementRequests(method, path, status) {
    this.metrics.httpRequests?.inc({ method, path, status });
  }

  observeRequestDuration(method, path, duration) {
    this.metrics.requestDuration?.observe({ method, path }, duration);
  }

  incrementIntegrationCalls(integration, provider, status) {
    this.metrics.integrationCalls?.inc({ integration, provider, status });
  }

  observeWebhookDelivery(endpoint, duration) {
    this.metrics.webhookDelivery?.observe({ endpoint }, duration);
  }

  setActiveConnections(count) {
    this.metrics.activeConnections?.set(count);
  }

  getMetrics() {
    return this.register.metrics();
  }

  async getMetricsAsText() {
    return this.register.metricsAsString();
  }
}

module.exports = Metrics;
