# 24/7 Autonomous Operation

## Render Cron (render.yaml)
crons:
  - name: night-shift-hunter
    schedule: "*/15 * * * *"  # every 15 min, 24/7
    task: night_shift
  - name: digest
    schedule: "0 8 * * *"  # 8am daily digest of P3
    task: batch_digest

## Human Approval Gate
- P0/P1 drafts created by outreach_agent land in `drafts` table with `needs_approval=true`
- Dashboard shows 🔥 ACTION NOW (2) → Approve / Edit / Reject
- ONLY after approval does ActionAgent send via WhatsApp/IG API
- Worker never spends budget or publishes without approval

## How it finds clients while you sleep
1. Webhooks push IG comments/TikTok mentions/WhatsApp/website forms → event_store
2. hunter_agent wakes every 15 min, normalizes, cheap_classifier, scores
3. 37 noise events → suppressed (P4)
4. 2-3 hot leads → outreach_agent drafts DM
5. You wake to dashboard: "3 hot leads ready - approve to send" + 1-click send
6. learning_agent tracks which drafts converted → tunes priority weights weekly
