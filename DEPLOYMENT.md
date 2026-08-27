# MassageVIP Automation - Deployment Guide

## Quick Deploy to Render (Recommended)

### Prerequisites
- GitHub account
- Render account (https://render.com)
- PostgreSQL database (Render PostgreSQL or external)
- AI API endpoint (OpenAI-compatible)
- WAHA instance or WhatsApp Business API credentials

### Step 1: Prepare Repository

1. Push this codebase to a GitHub repository
2. Ensure the following files are committed:
   - `main.py`
   - `requirements.txt`
   - `render.yaml`
   - `Dockerfile.waha`
   - `schema.sql`

### Step 2: Deploy Database

1. In Render dashboard, create a new **PostgreSQL** database
2. Note the connection string (format: `postgresql://user:pass@host:5432/dbname`)
3. Run the schema:
   ```bash
   psql YOUR_DATABASE_URL -f schema.sql
   ```

### Step 3: Deploy WAHA

1. In Render dashboard, create a new **Docker** service
2. Connect your GitHub repository
3. Set:
   - **Dockerfile Path**: `./Dockerfile.waha`
   - **Docker Context**: `.`
   - **Plan**: Starter (or higher)
4. Add environment variables:
   - `WHATSAPP_HOOK_URL`: `https://your-worker-name.onrender.com/webhook`
   - `WHATSAPP_HOOK_EVENTS`: `*`
   - `WAHA_API_KEY`: (generate a secure random string)
   - `WAHA_WEBHOOK_SECRET`: (generate a secure random string)
5. Deploy and wait for the service to start
6. Open the service URL to see the WAHA dashboard
7. Create a session and scan the QR code with your WhatsApp phone

### Step 4: Deploy Automation Worker

1. In Render dashboard, create a new **Worker** service
2. Connect your GitHub repository
3. Set:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python main.py`
   - **Plan**: Starter (or higher)
4. Add environment variables:
   - `AI_BASE_URL`: Your AI API URL
   - `AI_API_KEY`: Your AI API key
   - `AI_MODEL`: (optional) Model name
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `WAHA_BASE_URL`: `http://your-waha-service-name.onrender.com:3000`
   - `WAHA_SESSION`: `default`
   - `WAHA_API_KEY`: Same as WAHA service
   - `PORT`: `8080`
5. Deploy the service

### Step 5: Configure Webhook in WAHA

1. In WAHA dashboard, go to **Settings** → **Webhooks**
2. Set webhook URL to: `https://your-worker-name.onrender.com/webhook`
3. Set webhook secret to match `WAHA_WEBHOOK_SECRET`
4. Select events: `message`, `message-ack`
5. Save settings

### Step 6: Verify Deployment

1. Check worker logs in Render dashboard
2. Verify `/health` endpoint responds:
   ```
   https://your-worker-name.onrender.com/health
   ```
3. Verify `/dashboard` endpoint:
   ```
   https://your-worker-name.onrender.com/dashboard
   ```
4. Send a test WhatsApp message to your WAHA phone number
5. Check that the message appears in logs and is processed

## Local Deployment with Docker Compose

### Prerequisites
- Docker and Docker Compose installed
- PostgreSQL running locally or via Docker
- AI API endpoint accessible

### Step 1: Clone and Configure

```bash
git clone <your-repo-url>
cd massagevip-automation
cp .env.example .env
# Edit .env with your actual values
```

### Step 2: Start Database

```bash
# Option A: Use Docker
docker run -d \
  --name massagevip-db \
  -e POSTGRES_USER=app \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=massagevip \
  -p 5432:5432 \
  postgres:15

# Option B: Use existing PostgreSQL
# Ensure DATABASE_URL points to your database
```

### Step 3: Initialize Schema

```bash
psql $DATABASE_URL -f schema.sql
```

### Step 4: Start Services

```bash
docker-compose up -d
```

### Step 5: Verify

```bash
# Check WAHA is running
curl http://localhost:3000/api/status

# Check automation worker is running
curl http://localhost:8080/health

# Check dashboard
curl http://localhost:8080/dashboard
```

### Step 6: Scan QR Code

1. Open http://localhost:3000 in browser
2. Find `POST /api/sessions` and create a session named `default`
3. Find `GET /api/screenshot` to get QR code
4. Scan QR with WhatsApp phone
5. Verify screenshot shows WhatsApp Web

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_BASE_URL` | Yes | AI API base URL (OpenAI-compatible) |
| `AI_API_KEY` | Yes | AI API key |
| `AI_MODEL` | No | Model name (default: `gpt-oss:120b-cloud`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WAHA_BASE_URL` | No* | WAHA instance URL |
| `WAHA_SESSION` | No | WAHA session name (default: `default`) |
| `WAHA_API_KEY` | No* | WAHA API key |
| `WAHA_WEBHOOK_SECRET` | No* | Webhook verification secret |
| `WHATSAPP_ACCESS_TOKEN` | No** | Direct WhatsApp API token |
| `WHATSAPP_PHONE_NUMBER_ID` | No** | Direct WhatsApp phone ID |

*Required if using WAHA  
**Required if using Direct WhatsApp Cloud API (fallback)

## Post-Deployment Checklist

- [ ] `/health` returns all checks green
- [ ] `/dashboard` returns executive summary
- [ ] Test message sent and received
- [ ] Event appears in `event_store`
- [ ] AI qualification generated
- [ ] Decision engine produces action
- [ ] Reply sent back via WhatsApp
- [ ] Dead-letter queue is empty
- [ ] Structured logs are being emitted
- [ ] No secrets exposed in logs

## Troubleshooting

### WAHA not connecting
- Verify `WHATSAPP_HOOK_URL` is publicly accessible
- Check `WAHA_WEBHOOK_SECRET` matches in both services
- Ensure worker is running before WAHA tries to send webhooks

### AI API failures
- Check `AI_BASE_URL` is correct
- Verify `AI_API_KEY` is valid
- System falls back to rule-based classification if AI fails

### Database connection issues
- Verify `DATABASE_URL` format is correct
- Check PostgreSQL is running and accessible
- Ensure `schema.sql` has been executed

### Messages not being sent
- Verify WAHA session is active (scan QR)
- Check `WAHA_BASE_URL` is correct in worker
- Review worker logs for errors

## Scaling

- **Render**: Upgrade to higher plan for more CPU/memory
- **Database**: Use Render PostgreSQL with connection pooling
- **WAHA**: Multiple sessions can run in single WAHA instance
- **Worker**: Increase worker count for higher throughput

## Monitoring

- Check `/health` endpoint every 5 minutes
- Monitor `/dashboard` for metrics
- Set up alerts on dead-letter queue
- Review audit logs for unexpected decisions
