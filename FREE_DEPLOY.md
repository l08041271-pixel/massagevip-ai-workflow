# MassageVIP Automation - Free Deployment Guide

## Free Hosting Options

### 1. Render (Recommended - Easiest)

**Free Tier Includes:**
- PostgreSQL database (free)
- Web service (free, sleeps after 15 min inactivity)
- 512 MB RAM, 0.5 CPU

**Limitations:**
- Free web service spins down after 15 minutes of inactivity
- First request after sleep takes ~30 seconds
- 100 hours/month runtime limit

**Setup Steps:**

1. **Create free PostgreSQL database:**
   - Go to https://render.com → New → PostgreSQL
   - Name: `massagevip-db`
   - Plan: Free
   - Copy the connection string

2. **Initialize database:**
   ```bash
   psql YOUR_RENDER_DB_URL -f schema.sql
   ```

3. **Deploy worker as free web service:**
   - New → Web Service
   - Connect GitHub repo
   - Name: `automation-worker`
   - Environment: `Python 3`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn main:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120`
   - Plan: Free

4. **Set environment variables:**
   - `AI_BASE_URL`: Your AI API URL
   - `AI_API_KEY`: Your AI API key
   - `DATABASE_URL`: Your Render PostgreSQL URL
   - `WAHA_BASE_URL`: Your WAHA instance URL (or use direct WhatsApp API)
   - `WAHA_API_KEY`: (if using WAHA)
   - `WAHA_WEBHOOK_SECRET`: Random secret for webhook verification

5. **Deploy WAHA separately:**
   - Option A: Use a free Render Docker service (if available)
   - Option B: Run WAHA on your local machine with ngrok:
     ```bash
     docker run -p 3000:3000 devlikeapro/waha
     ngrok http 3000
     ```
   - Option C: Use a free Fly.io VM for WAHA

**Cost: $0/month**

---

### 2. Fly.io (Best for Always-Free)

**Free Tier Includes:**
- 3 shared VMs (256MB each)
- 160GB outbound bandwidth
- Persistent (doesn't sleep)

**Setup Steps:**

1. **Install Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth signup
   ```

2. **Create fly.toml:**
   ```toml
   app = "massagevip-automation"
   
   [env]
     PORT = "8080"
   
   [[services]]
     internal_port = 8080
     protocol = "tcp"
     
     [[services.ports]]
       port = 80
     
     [[services.ports]]
       port = 443
       handlers = ["tls", "http"]
       tls_options = { "alpn" = ["h2", "http/1.1"] }
   ```

3. **Deploy:**
   ```bash
   fly launch --no-deploy
   fly postgres create --name massagevip-db --org personal --region iad --plan free
   fly secrets set DATABASE_URL=flycast://massagevip-db:5432
   fly deploy
   ```

4. **Deploy WAHA:**
   ```bash
   fly launch --no-deploy --name waha
   fly deploy --image devlikeapro/waha:latest
   ```

**Cost: $0/month**

---

### 3. Railway (Generous Free Tier)

**Free Tier Includes:**
- $5 credit every month
- 512MB RAM, 1 CPU
- PostgreSQL included

**Setup Steps:**

1. **Push to GitHub**
2. **Go to railway.app → New Project → Deploy from GitHub**
3. **Add PostgreSQL plugin**
4. **Set environment variables**
5. **Deploy**

**Cost: $0/month (with $5 credit)**

---

### 4. Supabase + Vercel/Netlify (Serverless)

**Free Tier Includes:**
- Supabase: 500MB PostgreSQL, 2MB storage
- Vercel/Netlify: Serverless functions

**Limitations:**
- Serverless functions have timeout limits (10-30 seconds)
- Not ideal for long-running webhook processing

**Setup:**
1. Create Supabase project → get PostgreSQL URL
2. Deploy worker to Vercel as serverless function
3. Use Supabase for database

**Cost: $0/month**

---

### 5. Oracle Cloud Free Tier (Always Free)

**Free Tier Includes:**
- 2 AMD VMs (1GB RAM each)
- 200GB storage
- 2 Autonomous Databases (20GB each)

**Setup:**
1. Sign up at cloud.oracle.com
2. Create VM instance (Ubuntu)
3. Install Docker
4. Run docker-compose up

**Cost: $0/month (forever)**

---

## Recommended Free Stack

| Component | Free Service | Why |
|-----------|--------------|-----|
| **Worker** | Render free web service | Already configured, easiest setup |
| **Database** | Render free PostgreSQL | Integrated with Render |
| **WhatsApp** | WAHA on local + ngrok OR Fly.io free VM | WAHA needs persistent connection |

## Quickest Free Setup (10 minutes)

### Step 1: Database (Render)
```bash
# Create free PostgreSQL at render.com
# Copy connection string
```

### Step 2: Worker (Render)
```bash
# Push code to GitHub
# Create Web Service at render.com
# Connect repo
# Set env vars
# Deploy
```

### Step 3: WAHA (Local + Ngrok)
```bash
# Terminal 1: Start WAHA
docker run -p 3000:3000 devlikeapro/waha

# Terminal 2: Create tunnel
ngrok http 3000

# Use the ngrok URL in Render webhook settings
```

### Step 4: Test
```bash
curl https://your-worker.onrender.com/health
```

## Important Notes

1. **Free tiers sleep**: Render free web services sleep after 15 minutes of inactivity. Use a ping service like UptimeRobot to keep it awake.

2. **Webhook URL must be HTTPS**: Use Render's auto-generated HTTPS URL or ngrok HTTPS tunnel.

3. **Database persistence**: Free tiers may have data retention limits. Back up regularly.

4. **Rate limits**: Free tiers have CPU/memory limits. Monitor usage.

## Keeping Free Services Awake

Use a free cron service to ping your worker every 10 minutes:

```bash
# Sign up at uptimerobot.com (free)
# Add monitor: https://your-worker.onrender.com/health
# Interval: 10 minutes
```

## Cost Comparison

| Platform | Monthly Cost | Persistent | Limits |
|----------|-------------|------------|--------|
| Render | $0 | Sleeps | 100 hrs/month |
| Fly.io | $0 | Yes | 3 VMs, 160GB bandwidth |
| Railway | $0 | Yes | $5 credit/month |
| Oracle Cloud | $0 | Yes | 2 VMs forever |
| Vercel + Supabase | $0 | Serverless | 10s timeout |

## My Recommendation

**For testing**: Render free tier (easiest setup)

**For production (free)**: Fly.io (most reliable free tier)

**For easiest always-free**: Oracle Cloud (requires credit card signup but never charges)
