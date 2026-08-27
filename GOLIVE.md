# MassageVIP Automation - Go-Live Checklist

## LEI-21: Final Integration Test and Go-Live Gate

### Pre-Deployment Verification

- [ ] **Environment Variables**
  - [ ] `AI_BASE_URL` set and reachable
  - [ ] `AI_API_KEY` set and valid
  - [ ] `DATABASE_URL` set (PostgreSQL connection)
  - [ ] `WAHA_BASE_URL` set (e.g., `http://waha:3000` on Render)
  - [ ] `WAHA_SESSION` set (default: `default`)
  - [ ] `WAHA_API_KEY` set (if WAHA requires auth)
  - [ ] `WAHA_WEBHOOK_SECRET` set (for webhook verification)
  - [ ] `WHATSAPP_ACCESS_TOKEN` set (fallback direct API)
  - [ ] `WHATSAPP_PHONE_NUMBER_ID` set (fallback direct API)

- [ ] **Database Schema**
  - [ ] Run `schema.sql` against PostgreSQL
  - [ ] Verify all tables created: `contacts`, `conversations`, `event_store`, `events`, `outcomes`, `drafts`, `ai_memory`, `dead_letter_queue`, `audit_log`, `bookings`, `follow_ups`, `approvals`, `metrics`
  - [ ] Verify `daily_metrics` view created
  - [ ] Verify indexes created

- [ ] **Unit/Integration Tests**
  - [ ] Run `python3 test_integration.py`
  - [ ] All tests pass (target: 58 tests)
  - [ ] No import errors
  - [ ] No missing dependencies

- [ ] **Smoke Test**
  - [ ] Run `python3 smoke_test.py`
  - [ ] WAHA responds to `/api/status`
  - [ ] Webhook endpoint responds to `/health`
  - [ ] Test message sent successfully
  - [ ] Event appears in `event_store`
  - [ ] AI qualification generated
  - [ ] Decision engine produces action
  - [ ] Reply sent back via WAHA

- [ ] **Monitoring & Alerts**
  - [ ] `/health` endpoint returns all checks
  - [ ] `/metrics` endpoint accessible
  - [ ] `/dashboard` endpoint returns executive summary
  - [ ] Structured logs are being emitted
  - [ ] Dead-letter queue is empty or monitored

- [ ] **Security**
  - [ ] No secrets in code or `.env` files
  - [ ] Webhook signature verification enabled
  - [ ] Opt-out enforcement working
  - [ ] Human handoff overrides automation
  - [ ] Reply validation blocks forbidden patterns

- [ ] **Deployment**
  - [ ] `render.yaml` deployed successfully
  - [ ] WAHA Docker container running
  - [ ] Automation worker running
  - [ ] Database connected
  - [ ] Service URLs configured

### Rollback Plan

1. Stop automation worker on Render
2. Keep WAHA running (it queues messages)
3. Fix issue in code
4. Redeploy worker
5. Verify `/health` before resuming webhooks

### Post-Deployment Monitoring

- Check `/dashboard` every 15 minutes for first hour
- Monitor dead-letter queue for failures
- Verify no duplicate messages (idempotency)
- Confirm opt-out requests are respected
- Review audit log for unexpected decisions
