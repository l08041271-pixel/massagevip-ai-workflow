# API Documentation

## Core

### IntegrationRegistry

```javascript
const { IntegrationRegistry } = require('../../src/integrations');

const registry = new IntegrationRegistry();

// Register an integration
registry.register('crm', 'salesforce', salesforceIntegration);

// Get an integration
const salesforce = registry.get('crm', 'salesforce');

// List all integrations
const all = registry.list();
console.log(all.crm); // ['salesforce', 'hubspot']
```

### AuthHandler

```javascript
const { AuthHandler } = require('../../src/core/auth');

const auth = new AuthHandler({ jwtSecret: 'secret' });

// Generate JWT token
const token = auth.generateToken({ userId: 123 });

// Verify token
const decoded = auth.verifyToken(token);

// Hash password
const hash = await auth.hashPassword('password123');

// Verify password
const valid = await auth.verifyPassword('password123', hash);
```

### ApiClient

```javascript
const { ApiClient } = require('../../src/core/client');

const client = new ApiClient({
  baseURL: 'https://api.example.com',
  timeout: 30000,
  retries: 3
});

// REST methods
await client.get('/users');
await client.post('/users', { name: 'John' });
await client.put('/users/1', { name: 'Jane' });
await client.patch('/users/1', { name: 'Jane' });
await client.delete('/users/1');
```

## Integrations

### CRM

#### Salesforce
```javascript
const salesforce = registry.get('crm', 'salesforce');
await salesforce.createRecord('Account', { Name: 'Acme Corp' });
await salesforce.query('SELECT Id, Name FROM Account');
```

#### HubSpot
```javascript
const hubspot = registry.get('crm', 'hubspot');
await hubspot.createContact({ email: 'user@example.com', firstname: 'John' });
await hubspot.getContacts({ limit: 100 });
```

### Sheets

#### Google Sheets
```javascript
const sheets = registry.get('sheets', 'google');
await sheets.getValues('spreadsheetId', 'Sheet1!A1:D10');
await sheets.appendValues('spreadsheetId', 'Sheet1', [[1, 2, 3]]);
```

#### CSV
```javascript
const csv = registry.get('sheets', 'csv');
const data = await csv.read('./data/file.csv');
await csv.write('./data/output.csv', data, ['id', 'name', 'value']);
```

### Analytics

#### Google Analytics
```javascript
const ga = registry.get('analytics', 'google');
await ga.runReport('propertyId', { dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }] });
```

#### Mixpanel
```javascript
const mixpanel = registry.get('analytics', 'mixpanel');
await mixpanel.track('Button Clicked', { buttonId: 'signup' });
await mixpanel.identify('user123', { plan: 'pro' });
```

### Payments

#### Stripe
```javascript
const stripe = registry.get('payments', 'stripe');
const paymentIntent = await stripe.createPaymentIntent(2000, 'usd', { orderId: '123' });
await stripe.confirmPaymentIntent(paymentIntent.id);
```

#### PayPal
```javascript
const paypal = registry.get('payments', 'paypal');
const payment = await paypal.createPayment(2000, 'USD', 'Test payment');
await paypal.executePayment(payment.id, payerId);
```

### Email

#### Mailchimp
```javascript
const mailchimp = registry.get('email', 'mailchimp');
await mailchimp.addSubscriber(listId, 'user@example.com', { FNAME: 'John' });
await mailchimp.createCampaign(listId, 'Newsletter', '<h1>Hello</h1>');
```

#### ConvertKit
```javascript
const convertkit = registry.get('email', 'convertkit');
await convertkit.addSubscriberToList(listId, 'user@example.com');
await convertkit.addTagToSubscriber(tagId, 'user@example.com');
```

## Webhooks

### Incoming Webhooks
```javascript
const webhooks = new WebhooksModule();
webhooks.incoming.register('order_created', async (payload) => {
  console.log('New order:', payload);
});
```

### Outgoing Webhooks
```javascript
webhooks.outgoing.register('order_created', {
  url: 'https://example.com/webhook',
  secret: process.env.WEBHOOK_SECRET
});
await webhooks.outgoing.send('order_created', { orderId: 123 });
```

## Sync

```javascript
const sync = new SyncModule();
await sync.initialize({ mode: 'hybrid', batchSize: 100 });

// Realtime mode
await sync.sync('salesforce', 'hubspot', records, { priority: 'high' });

// Batch mode
await sync.sync('sheets', 'mixpanel', records, { priority: 'low' });
```

## Monitoring

```javascript
const monitoring = new MonitoringModule();
await monitoring.initialize({
  logLevel: 'info',
  metrics: { enabled: true },
  alerts: { enabled: true, email: 'alerts@example.com' }
});

// Logging
monitoring.logger.info('Processing order', { orderId: 123 });
monitoring.logger.error('Order failed', { orderId: 123, error: err.message });

// Metrics
monitoring.metrics.incrementRequests('GET', '/api/orders', 200);
monitoring.metrics.observeRequestDuration('GET', '/api/orders', 0.5);

// Alerts
monitoring.alerts.addRule('high_error_rate', {
  metric: 'errorRate',
  threshold: 0.05
});
await monitoring.alerts.evaluate('errorRate', 0.08);
```
