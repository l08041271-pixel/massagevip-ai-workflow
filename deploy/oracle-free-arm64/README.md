# Oracle Cloud Always Free ARM64 deployment

This deployment runs the existing MassageVIP Python service, PostgreSQL and Cloudflare Tunnel on one Oracle Cloud Infrastructure (OCI) Ampere A1 VM. It does not replace existing production Workers or webhook routes.

## Free-tier sizing and caveats

As checked against Oracle's Always Free documentation on 2026-11-10, the A1 allowance is 1,500 OCPU-hours and 9,000 GB-hours per month, equivalent to **2 OCPUs and 12 GB RAM continuously**. The combined Always Free block-volume allowance is 200 GB, and outbound transfer allowance is 10 TB/month. These are tenancy-wide limits in the home region, not per-instance promises.

- Choose the **VM.Standard.A1.Flex** shape and stay within 2 OCPUs / 12 GB RAM total.
- Use an Always Free-eligible boot volume (default 50 GB) in the tenancy home region.
- Capacity is not guaranteed. An "out of host capacity" error means retry later or try another availability domain in the home region.
- Do not create paid resources, paid support, paid load balancers, or extra storage.
- Do not upgrade to Pay As You Go if the requirement is a hard $0 ceiling.
- Add a billing budget/usage alert where available; an alert is not a spending cap.
- Oracle may require identity/payment verification during signup. Check the current signup terms before proceeding.

Official limits: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

## What this deploys

- Existing Python application from the repository root (Dockerfile, main.py).
- PostgreSQL 16 with a persistent Docker volume and initial schema.sql.
- Cloudflare Tunnel connector; no public application or database port is published.
- The app is reachable only through the configured Cloudflare Tunnel hostname.

This is a hosting baseline. It does **not** by itself implement the OpenAI Agents multi-agent coordinator, YCloud-specific webhook adapter, Cloudflare Queues, or Google Sheets synchronization. Those integrations must be implemented and verified separately before production use.

## 1. Create the OCI VM

1. Create or sign in to an OCI Free Tier account: https://www.oracle.com/cloud/free/
2. Select your tenancy's home region.
3. Create a Compute instance using Ubuntu 24.04 ARM64 (aarch64).
4. Select VM.Standard.A1.Flex and set 2 OCPUs and 12 GB memory, provided the console marks it Always Free eligible.
5. Use a 50 GB boot volume and confirm it is Always Free eligible.
6. Generate and download an SSH key pair. Keep the private key off GitHub and out of chat.
7. Configure a VCN/subnet with a public IPv4 address if you need direct SSH. Allow inbound TCP 22 only from your current trusted IP. Do not open 80, 443, 3000, 5432, or Docker's remote API.
8. Do not create any resource whose console label or estimated cost is not explicitly Always Free.

If the VM cannot be created due to A1 capacity, do not switch to a paid shape. Retry later or use the Google Cloud e2-micro free tier only as a small, US-region fallback.

## 2. Install Docker on Ubuntu ARM64

SSH into the VM:

~~~bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
~~~

Log out and reconnect, then verify:

~~~bash
uname -m
docker --version
docker compose version
~~~

Expected architecture: aarch64 or arm64. The repository's Python slim base image is multi-architecture; still verify the image builds on the VM before production.

## 3. Clone and configure

~~~bash
git clone https://github.com/l08041271-pixel/massagevip-ai-workflow.git
cd massagevip-ai-workflow
git checkout deploy/oracle-free-arm64
cp deploy/oracle-free-arm64/.env.example .env
chmod 600 .env
~~~

Edit .env on the VPS. Generate a database password using hex characters so it is safe in the Compose connection URL:

~~~bash
openssl rand -hex 32
~~~

Set the generated value as POSTGRES_PASSWORD. Set the actual AI provider key and the Cloudflare Tunnel token locally. Never paste credentials into GitHub, logs, or chat.

## 4. Create the Cloudflare Tunnel

1. In Cloudflare Zero Trust, create a remotely managed tunnel.
2. Copy its connector token directly into the VPS .env as CLOUDFLARE_TUNNEL_TOKEN.
3. Configure a published application route for your chosen hostname, with service URL http://app:8080 when the tunnel connector is running in this Compose network.
4. Do not publish the PostgreSQL service.
5. Do not put the tunnel token in Git or a Docker image.

## 5. Start services

From the repository root:

~~~bash
docker compose -f deploy/oracle-free-arm64/compose.yaml config
docker compose -f deploy/oracle-free-arm64/compose.yaml build
docker compose -f deploy/oracle-free-arm64/compose.yaml up -d
docker compose -f deploy/oracle-free-arm64/compose.yaml ps
docker compose -f deploy/oracle-free-arm64/compose.yaml logs --tail=100 app db cloudflared
~~~

The database schema is mounted into PostgreSQL's first-initialization directory. It runs only when the data volume is empty. For an existing database, take a backup and apply migrations deliberately; do not delete the volume to force schema initialization.

## 6. Verify

- Open the configured HTTPS hostname and check /health.
- Confirm the app reports database health.
- Confirm the PostgreSQL container is healthy.
- Confirm Cloudflare Tunnel shows the connector as healthy.
- Run the repository's unit/integration tests before sending real messages.
- Use synthetic leads and a test webhook first.
- Confirm duplicate webhook delivery does not create duplicate records.
- Confirm opt-outs and human handoff are enforced.
- Confirm no raw phone numbers or secrets are emitted in application logs.

Useful commands:

~~~bash
docker compose -f deploy/oracle-free-arm64/compose.yaml ps
docker compose -f deploy/oracle-free-arm64/compose.yaml logs --since=15m
docker stats --no-stream
~~~

## 7. Backups and recovery

- Back up PostgreSQL daily to encrypted storage outside the VM.
- Test a restore before relying on the backup.
- Keep the database volume persistent; 'docker compose down -v' destroys it.
- Update containers deliberately and retain a known-good image/version for rollback.
- Monitor disk usage, memory, CPU, tunnel status and database health.

## 8. Production gate

Do not route the live YCloud webhook or live WhatsApp traffic to this VM until all of the following are verified:

- Current provider signature verification matches the actual YCloud webhook contract.
- The existing webhook remains available for rollback.
- PostgreSQL backups and restore are tested.
- The service has authentication, rate limiting and idempotency.
- The multi-agent session implementation is added and tested (this compose file only hosts the existing Python app).
- Data minimization, retention and cross-border processing requirements are reviewed for Saudi Arabia.
- A controlled staging test succeeds.

## Rollback

Remove or disable the Cloudflare Tunnel public hostname route first. Leave the existing production Worker/webhook untouched. Inspect logs and preserve the database volume for diagnosis. Do not run 'docker compose down -v'.
