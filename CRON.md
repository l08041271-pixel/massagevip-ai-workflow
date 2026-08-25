# 24/7 Fully Autonomous Operation

## Render Cron (render.yaml)
```yaml
crons:
  - name: night-shift-hunter
    schedule: "*/10 * * * *"  # every 10 min, 24/7 (faster detection)
    task: night_shift
  - name: auto-action-executor
    schedule: "*/5 * * * *"   # every 5 min, send approved drafts
    task: execute_actions
  - name: learning-loop
    schedule: "0 */2 * * *"   # every 2 hours, optimize weights
    task: learning_agent
  - name: performance-report
    schedule: "0 6 * * *"     # 6am daily performance metrics
    task: daily_report
```

## Fully Autonomous Pipeline (No Human Loop)

### Stage 1: Lead Detection (Every 10 min)
```
Webhooks (IG/TikTok/WhatsApp/Forms) → event_store
    ↓
hunter_agent normalizes + cheap_classifier + confidence scoring
    ↓
Split by priority:
  • P0 (95%+ confidence) → outreach_agent immediately
  • P1 (80-95% confidence) → outreach_agent with context
  • P2 (60-80% confidence) → queue for learning loop refinement
  • P3-P4 (< 60%) → suppressed, tracked for model improvement
```

### Stage 2: Automatic Outreach (No Approval)
```
outreach_agent generates DM/reply
    ↓
Message passes autonomous safety checks:
  ✓ Budget available?
  ✓ Message length valid?
  ✓ No spam patterns detected?
  ✓ Rate limits OK (no > 10 msgs to same user/hour)?
  ✓ Tone confidence > 85%?
    ↓
YES → ActionAgent SENDS immediately via WhatsApp/IG/TikTok
NO  → Flag for learning_agent to investigate, suppress similar patterns
```

### Stage 3: Real-Time Learning Loop (Every 2 hours)
```
learning_agent analyzes outcomes:
  • Sent messages → track replies, conversions, drop-offs
  • Failed sends → categorize errors, adjust classifier weights
  • Response patterns → update prompt templates
  • Budget efficiency → recalibrate message priority
    ↓
Auto-tune weights for next cycle (no manual intervention)
Update classifier thresholds based on recent conversion rates
```

### Stage 4: Autonomous Performance Reports (6am Daily)
```
Metrics logged to database:
  • Total leads processed
  • Conversion rate by priority bucket
  • Messages sent / budget spent / ROI
  • Top performing message templates
  • Error categories + counts
  • Recommended threshold adjustments
    ↓
No human action required — all data available for review
Agents use metrics to self-optimize
```

## Safety Guardrails (No Humans Needed)

| Guardrail | Threshold | Action |
|-----------|-----------|--------|
| Budget daily spend | $50 limit | Stop all sends, alert logs |
| Message rate per user | 10 msgs/hour | Pause, add exponential backoff |
| Reply timeout | 48 hours no response | Mark cold, reduce future priority |
| Spam pattern detection | 3+ same template in 30 min | Pause, regenerate templates |
| API failure rate | > 5% in 10 min | Circuit break, exponential retry |
| Confidence threshold drift | < 65% avg | Reset to baseline, log anomaly |

## Decision Tree: When to Send (Fully Automatic)

```
Lead arrives
  │
  ├─ Confidence score?
  │   ├─ 95%+ → SEND immediately (P0)
  │   ├─ 80-95% → SEND with slight delay (P1, avoid bulk)
  │   ├─ 60-80% → Queue for next cycle (P2, low priority)
  │   └─ <60% → Suppress (P3-P4)
  │
  ├─ Budget check?
  │   ├─ Available → proceed
  │   └─ Depleted → hold, log, resume next cycle
  │
  ├─ Spam/rate limit check?
  │   ├─ OK → proceed
  │   └─ Violated → exponential backoff
  │
  ├─ Tone/safety check?
  │   ├─ Pass → SEND
  │   └─ Fail → flag, regenerate, retry
  │
  └─ Success → track response, log metrics
```

## Database Schema Changes

### `leads` table
```sql
ALTER TABLE leads ADD COLUMN (
  auto_confidence_score FLOAT,
  priority_bucket CHAR(2),  -- P0, P1, P2, P3, P4
  last_contact_attempt TIMESTAMP,
  contact_attempts INT DEFAULT 0,
  conversion_status ENUM('pending', 'replied', 'converted', 'cold'),
  auto_actions_triggered INT DEFAULT 0
);
```

### `messages_sent` table (new)
```sql
CREATE TABLE messages_sent (
  id BIGINT PRIMARY KEY,
  lead_id BIGINT,
  message TEXT,
  channel ENUM('whatsapp', 'instagram', 'tiktok'),
  sent_at TIMESTAMP,
  status ENUM('sent', 'delivered', 'read', 'replied', 'failed'),
  reply_at TIMESTAMP,
  template_id VARCHAR(50),
  confidence_score FLOAT,
  cost_cents INT,
  created_at TIMESTAMP
);
```

### `performance_metrics` table (new)
```sql
CREATE TABLE performance_metrics (
  id BIGINT PRIMARY KEY,
  metric_date DATE,
  total_leads_processed INT,
  leads_by_priority JSON,  -- {P0: 10, P1: 25, P2: 40, P3: 100, P4: 200}
  messages_sent INT,
  messages_replied INT,
  conversion_rate FLOAT,
  total_spend_cents INT,
  roi FLOAT,
  top_templates JSON,
  error_log JSON,
  created_at TIMESTAMP
);
```

## Autonomy Levels

### Level 1: Safe Automation (Current)
- ✅ Auto-send P0 leads (95%+ confidence)
- ✅ Auto-send P1 leads (80-95% confidence, rate-limited)
- ✅ Auto-suppress P3-P4 (noise, < 60% confidence)
- ✅ Self-learning loop tunes weights
- ❌ No rollback on errors — flag and pause

### Level 2: Smart Autonomy (Next Phase)
- ✅ Everything in Level 1
- ✅ Auto-retry failed sends with regenerated messages
- ✅ Auto-adjust priority thresholds based on conversion trends
- ✅ Circuit breakers + exponential backoff on API failures
- ⚠️ Humans monitor, don't approve

### Level 3: Deep Autonomy (Future)
- ✅ Everything in Levels 1-2
- ✅ Dynamic budget allocation across channels
- ✅ Prompt template auto-generation from successful conversations
- ✅ Lead scoring combines multi-modal signals (text + image + behavior)
- ✅ Zero human intervention, full self-improvement loop

## Monitoring Without Human Approval

- **Slack alerts** (not dashboards): Only on errors/thresholds breached
  - "🚨 Budget hit $50 — pausing sends until tomorrow"
  - "⚠️ API failure rate 8% — circuit breaker active"
  - "✅ Daily: 47 leads, 12 conversions, $18 spent, 67% ROI"

- **Database metrics** always available for review (not action)
- **No manual approval step** — all decisions made by agents

## Migration from Human-In-Loop to Fully Autonomous

1. **Phase 1** (Week 1): Keep approval gate, log what agents would do autonomously
2. **Phase 2** (Week 2): Auto-send P0 only, manual approve P1-P2
3. **Phase 3** (Week 3): Auto-send P0+P1, manual approve P2
4. **Phase 4** (Week 4): Full autonomy, monitor only
