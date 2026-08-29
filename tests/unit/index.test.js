module.exports = {
  'Core': {
    'index': './core/index.js',
    'client': './core/client.js',
    'auth': './core/auth.js',
    'utils': './core/utils.js'
  },
  'Integrations': {
    'index': './integrations/index.js',
    'CRM': {
      'index': './integrations/crm/index.js',
      'salesforce': './integrations/crm/salesforce.js',
      'hubspot': './integrations/crm/hubspot.js'
    },
    'Sheets': {
      'index': './integrations/sheets/index.js',
      'google-sheets': './integrations/sheets/google-sheets.js',
      'csv-handler': './integrations/sheets/csv-handler.js'
    },
    'Analytics': {
      'index': './integrations/analytics/index.js',
      'google-analytics': './integrations/analytics/google-analytics.js',
      'mixpanel': './integrations/analytics/mixpanel.js'
    },
    'Payments': {
      'index': './integrations/payments/index.js',
      'stripe': './integrations/payments/stripe.js',
      'paypal': './integrations/payments/paypal.js'
    },
    'Email': {
      'index': './integrations/email/index.js',
      'mailchimp': './integrations/email/mailchimp.js',
      'convertkit': './integrations/email/convertkit.js'
    }
  },
  'Webhooks': {
    'index': './webhooks/index.js',
    'incoming': './webhooks/incoming.js',
    'outgoing': './webhooks/outgoing.js'
  },
  'Sync': {
    'index': './sync/index.js',
    'realtime': './sync/realtime.js',
    'batch': './sync/batch.js',
    'hybrid': './sync/hybrid.js'
  },
  'Monitoring': {
    'index': './monitoring/index.js',
    'logger': './monitoring/logger.js',
    'metrics': './monitoring/metrics.js',
    'alerts': './monitoring/alerts.js'
  }
};
