# Deployment Guide

## Prerequisites

- Node.js >= 18.0.0
- PostgreSQL 12+
- Redis 6+ (optional)
- SSL certificate (production)
- SMTP server (for alerts)

## Environment Setup

### Development
```bash
npm run setup
npm run dev
```

### Staging
```bash
NODE_ENV=staging npm run deploy
```

### Production
```bash
NODE_ENV=production npm run deploy
```

## Deployment Steps

### 1. Environment Variables
Copy `.env.example` to `.env` and configure:
- Database connection strings
- Redis connection strings
- JWT and encryption secrets
- Third-party API keys

### 2. Database Setup
```bash
npm run migrate up
```

### 3. Build and Start
```bash
npm install --production
npm start
```

### 4. Health Check
```bash
curl https://your-domain.com/health
```

## Monitoring

- Metrics endpoint: `http://your-domain.com:9090/metrics`
- Logs: `logs/combined.log` and `logs/error.log`

## Scaling

- Use horizontal scaling with a load balancer
- Enable Redis for session/cache sharing
- Configure PostgreSQL connection pooling
