# Integrations Documentation

## CRM Integrations

### Salesforce
- **API Version**: v58.0
- **Authentication**: OAuth 2.0
- **Endpoints**: REST API
- **Rate Limits**: API requests based on org edition

**Configuration**:
```json
{
  "salesforce": {
    "loginUrl": "https://login.salesforce.com",
    "apiVersion": "v58.0",
    "auth": {
      "clientId": "your-client-id",
      "clientSecret": "your-client-secret",
      "refreshToken": "your-refresh-token"
    }
  }
}
```

**Supported Objects**:
- Account
- Contact
- Lead
- Opportunity
- Case

### HubSpot
- **API Version**: v3
- **Authentication**: Private App Access Token
- **Endpoints**: CRM Objects API

**Configuration**:
```json
{
  "hubspot": {
    "portalId": "your-portal-id",
    "apiKey": "your-api-key"
  }
}
```

**Supported Objects**:
- Contacts
- Companies
- Deals
- Tickets
- Products

## Sheets Integrations

### Google Sheets
- **API**: Google Sheets API v4
- **Authentication**: Service Account
- **Format**: JSON/CSV export

**Configuration**:
```json
{
  "googleSheets": {
    "credentialsPath": "./credentials/google-sheets.json"
  }
}
```

### CSV Handler
- **Format**: CSV
- **Features**: Read, write, append, validate

## Analytics Integrations

### Google Analytics
- **API**: Google Analytics Data API
- **Authentication**: Service Account
- **Features**: Reports, real-time data

**Configuration**:
```json
{
  "googleAnalytics": {
    "propertyId": "your-property-id",
    "credentialsPath": "./credentials/google-analytics.json"
  }
}
```

### Mixpanel
- **API**: Mixpanel Data API
- **Authentication**: API Secret + Token
- **Features**: Event tracking, user profiles

**Configuration**:
```json
{
  "mixpanel": {
    "token": "your-project-token",
    "apiSecret": "your-api-secret"
  }
}
```

## Payments Integrations

### Stripe
- **API Version**: 2024-06-20
- **Authentication**: Secret Key
- **Features**: Payments, subscriptions, webhooks

**Configuration**:
```json
{
  "stripe": {
    "secretKey": "sk_test_...",
    "webhookSecret": "whsec_...",
    "apiVersion": "2024-06-20"
  }
}
```

### PayPal
- **Modes**: sandbox, live
- **Authentication**: Client ID + Secret
- **Features**: Payments, subscriptions, payouts

**Configuration**:
```json
{
  "paypal": {
    "mode": "sandbox",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  }
}
```

## Email Integrations

### Mailchimp
- **API**: Mailchimp Marketing API
- **Authentication**: API Key
- **Features**: Lists, campaigns, subscribers

**Configuration**:
```json
{
  "mailchimp": {
    "serverPrefix": "us1",
    "apiKey": "your-api-key"
  }
}
```

### ConvertKit
- **API**: ConvertKit API v3
- **Authentication**: API Key
- **Features**: Subscribers, tags, forms

**Configuration**:
```json
{
  "convertkit": {
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```
