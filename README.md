# Bots.Business Integration Framework

A comprehensive integration framework for the Bots.Business platform connecting CRM, Sheets, Analytics, Payments, and Email services.

## Features

- **Multi-Provider Support**: Connect to multiple providers per category (Salesforce, HubSpot, Google Sheets, Google Analytics, Mixpanel, Stripe, PayPal, Mailchimp, ConvertKit)
- **Unified API**: Consistent interface across all integrations
- **Authentication**: Built-in JWT and OAuth handling
- **Webhooks**: Incoming and outgoing webhook support with signature verification
- **Sync Strategies**: Realtime, batch, and hybrid synchronization modes
- **Monitoring**: Logging, metrics, and alerting built-in
- **Security**: Rate limiting, encryption, and IP whitelisting

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- PostgreSQL (optional, for persistence)
- Redis (optional, for caching)

### Installation

```bash
# Clone the repository
git clone https://github.com/bots-business/integration-framework.git
cd integration-framework

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
nano .env

# Run setup
npm run setup

# Start development server
npm run dev
```

## Configuration

The framework uses JSON configuration files with environment-specific overrides:

```
config/
├── default.json           # Base configuration
├── production.json        # Production overrides
└── environments/
    ├── development.json
    ├── staging.json
    └── production.json
```

## Project Structure

```
src/
├── core/           # Core framework (client, auth, utils)
├── integrations/   # Integration providers
│   ├── crm/        # Salesforce, HubSpot
│   ├── sheets/     # Google Sheets, CSV
│   ├── analytics/  # Google Analytics, Mixpanel
│   ├── payments/   # Stripe, PayPal
│   └── email/      # Mailchimp, ConvertKit
├── webhooks/       # Incoming/Outgoing webhook handlers
├── sync/           # Realtime, batch, hybrid sync
└── monitoring/     # Logging, metrics, alerts
```

## Usage

### Register an Integration

```javascript
const { IntegrationRegistry } = require('./src/integrations');

const registry = new IntegrationRegistry();
registry.register('crm', 'salesforce', require('./src/integrations/crm/salesforce'));

await registry.initialize({
  crm: {
    enabled: true,
    providers: ['salesforce'],
    salesforce: {
      loginUrl: 'https://login.salesforce.com',
      auth: { /* ... */ }
    }
  }
});
```

### Using an Integration

```javascript
const salesforce = registry.get('crm', 'salesforce');

// Create a record
await salesforce.createRecord('Account', {
  Name: 'Acme Corp',
  Industry: 'Technology'
});

// Query records
const results = await salesforce.query('SELECT Id, Name FROM Account');
```

### Webhooks

```javascript
const { WebhooksModule } = require('./src/webhooks');

const webhooks = new WebhooksModule();
webhooks.incoming.register('crm_update', async (payload) => {
  console.log('Received CRM update:', payload);
});

await webhooks.initialize({
  incoming: { verifySignature: true },
  outgoing: { maxRetries: 3 }
});
```

### Sync

```javascript
const { SyncModule } = require('./src/sync');

const sync = new SyncModule();
await sync.initialize({ mode: 'hybrid', batchSize: 100 });

await sync.sync('salesforce', 'hubspot', records, { priority: 'high' });
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Start production server |
| `npm run dev` | Start development server with nodemon |
| `npm test` | Run all tests with coverage |
| `npm run test:unit` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run lint` | Run ESLint |
| `npm run migrate` | Run database migrations |
| `npm run setup` | Run initial setup |
| `npm run deploy` | Deploy to current environment |

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Environment Variables

See `.env.example` for all available environment variables.

## License

MIT
