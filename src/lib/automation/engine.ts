import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { scoreLead } from '@/lib/lead-scoring';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

/**
 * Event-driven automation engine.
 *
 * Guarantees:
 *  - Idempotency: each (rule, trigger, entity) tuple maps to one execution via
 *    a deterministic idempotencyKey with a DB unique constraint.
 *  - Retries: failed executions are retried with backoff up to rule.maxRetries.
 *  - Observability: every attempt writes to AutomationExecution.output/error.
 *  - Safety: message-sending actions require a configured integration; they are
 *    recorded as skipped (not silently "sent") otherwise.
 */

export type ActionType =
  | 'score_lead'
  | 'update_status'
  | 'schedule_follow_up'
  | 'create_task'
  | 'notify_owner'
  | 'send_whatsapp'
  | 'add_note';

export interface ActionDef {
  type: ActionType;
  params?: Record<string, unknown>;
}

export interface TriggerContext {
  organizationId: string;
  trigger: string;
  entityId?: string;
  leadId?: string;
  actorId?: string;
  payload?: Record<string, unknown>;
}

export function idempotencyKey(organizationId: string, ruleId: string | null, trigger: string, entityId?: string) {
  return createHash('sha256').update([organizationId, ruleId ?? 'all', trigger, entityId ?? 'none'].join('|')).digest('hex');
}

function backoffMs(attempt: number) {
  return Math.min(60_000, 1_000 * 2 ** attempt);
}

/**
 * Dispatch a trigger: create (or reuse) an execution for every enabled, non-paused
 * matching rule, then run it. Returns the executions touched.
 */
export async function dispatch(ctx: TriggerContext) {
  const rules = await prisma.automationRule.findMany({
    where: { organizationId: ctx.organizationId, trigger: ctx.trigger, enabled: true, paused: false },
  });
  const results = [];
  for (const rule of rules) {
    if (!matchesConditions(rule.conditions, ctx)) continue;
    const key = idempotencyKey(ctx.organizationId, rule.id, ctx.trigger, ctx.entityId);
    const existing = await prisma.automationExecution.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      // Duplicate event — safe no-op.
      results.push({ executionId: existing.id, deduped: true });
      continue;
    }
    const execution = await prisma.automationExecution.create({
      data: {
        organizationId: ctx.organizationId,
        ruleId: rule.id,
        trigger: ctx.trigger,
        idempotencyKey: key,
        status: 'pending',
        maxRetries: rule.maxRetries,
        input: JSON.stringify({ entityId: ctx.entityId, leadId: ctx.leadId, payload: ctx.payload ?? {} }),
      },
    });
    const outcome = await runExecution(execution.id);
    results.push({ executionId: execution.id, deduped: false, ...outcome });
  }
  return results;
}

function matchesConditions(conditionsJson: string | null, ctx: TriggerContext): boolean {
  if (!conditionsJson) return true;
  try {
    const cond = JSON.parse(conditionsJson) as Record<string, unknown>;
    const payload = ctx.payload ?? {};
    for (const [k, v] of Object.entries(cond)) {
      if (payload[k] !== v) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/** Execute a single automation run, applying retry/backoff semantics. */
export async function runExecution(executionId: string) {
  const execution = await prisma.automationExecution.findUnique({ where: { id: executionId }, include: { rule: true } });
  if (!execution || !execution.rule) return { status: 'skipped' as const };

  const actions = parseActions(execution.rule.actions);
  const log: string[] = [];
  await prisma.automationExecution.update({
    where: { id: executionId },
    data: { status: 'running', startedAt: new Date(), attempts: execution.attempts + 1 },
  });

  try {
    for (const action of actions) {
      const line = await runAction(action, execution.organizationId, execution.input, execution.rule.trigger);
      log.push(line);
    }
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: 'succeeded', output: log.join('\n'), finishedAt: new Date(), error: null },
    });
    await prisma.automationRule.update({ where: { id: execution.rule.id }, data: { lastRunAt: new Date() } });
    return { status: 'succeeded' as const, log };
  } catch (e) {
    const attempt = execution.attempts + 1;
    const canRetry = attempt <= execution.maxRetries;
    const error = e instanceof Error ? e.message : 'automation action failed';
    await prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: canRetry ? 'pending' : 'failed',
        error,
        output: log.join('\n'),
        nextRetryAt: canRetry ? new Date(Date.now() + backoffMs(attempt)) : null,
        finishedAt: canRetry ? null : new Date(),
      },
    });
    return { status: canRetry ? ('retrying' as const) : ('failed' as const), error };
  }
}

/** Process executions whose backoff window has elapsed. Safe to call from a cron endpoint. */
export async function processRetries(limit = 25) {
  const due = await prisma.automationExecution.findMany({
    where: { status: 'pending', nextRetryAt: { lte: new Date() }, attempts: { gt: 0 } },
    take: limit,
    orderBy: { nextRetryAt: 'asc' },
  });
  const outcomes = [];
  for (const e of due) outcomes.push(await runExecution(e.id));
  return outcomes;
}

function parseActions(json: string): ActionDef[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ActionDef[]) : [];
  } catch {
    return [];
  }
}

async function runAction(action: ActionDef, organizationId: string, inputJson: string | null, trigger: string): Promise<string> {
  const input = inputJson ? (JSON.parse(inputJson) as { leadId?: string; entityId?: string; payload?: Record<string, unknown> }) : {};
  const leadId = input.leadId ?? (trigger.startsWith('lead.') ? input.entityId : undefined);

  switch (action.type) {
    case 'score_lead': {
      if (!leadId) return 'score_lead: skipped (no lead) ';
      const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId }, include: { activities: true, bookings: true } });
      if (!lead) return 'score_lead: skipped (lead not found)';
      const result = scoreLead({
        email: lead.email, phone: lead.phone, company: lead.company, source: lead.source,
        intent: lead.intent, serviceInterest: lead.serviceInterest, budget: lead.budget,
        status: lead.status, activityCount: lead.activities.length,
        lastContactedAt: lead.lastContactedAt, createdAt: lead.createdAt, hasBooking: lead.bookings.length > 0,
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: { score: result.score, scoreCategory: result.category, scoreExplanation: result.explanation, recommendedAction: result.recommendedAction, scoreReasons: JSON.stringify(result.reasons) },
      });
      return `score_lead: ${result.score} (${result.category})`;
    }
    case 'update_status': {
      if (!leadId) return 'update_status: skipped (no lead)';
      const status = String(action.params?.status ?? 'CONTACTED');
      await prisma.lead.updateMany({ where: { id: leadId, organizationId }, data: { status } });
      await prisma.leadActivity.create({ data: { organizationId, leadId, type: 'status_change', message: `Automation set status to ${status}` } });
      return `update_status: ${status}`;
    }
    case 'schedule_follow_up': {
      if (!leadId) return 'schedule_follow_up: skipped (no lead)';
      const days = Number(action.params?.days ?? 2);
      const followUpAt = new Date(Date.now() + days * 86_400_000);
      await prisma.lead.updateMany({ where: { id: leadId, organizationId }, data: { followUpAt } });
      return `schedule_follow_up: +${days}d`;
    }
    case 'create_task': {
      await prisma.task.create({
        data: {
          organizationId,
          title: String(action.params?.title ?? 'Follow up with lead'),
          description: action.params?.description ? String(action.params.description) : null,
          priority: String(action.params?.priority ?? 'normal'),
          relatedLeadId: leadId,
          dueAt: new Date(Date.now() + 86_400_000),
        },
      });
      return 'create_task: created';
    }
    case 'notify_owner': {
      await prisma.leadActivity.create({
        data: { organizationId, leadId: leadId ?? '', type: 'system', message: String(action.params?.message ?? 'Automation notification: new activity requires attention.') },
      }).catch(() => undefined);
      return 'notify_owner: recorded';
    }
    case 'send_whatsapp': {
      const phone = String(action.params?.to ?? input.payload?.phone ?? '');
      if (!phone) return 'send_whatsapp: skipped (no phone number)';
      const res = await sendWhatsAppMessage(phone, String(action.params?.body ?? 'Hello from GrowthPilot AI'));
      if (!res.ok) throw new Error(`send_whatsapp failed: ${res.error}`);
      return `send_whatsapp: ${res.mock ? 'mock (not delivered)' : 'accepted by provider'}`;
    }
    case 'add_note': {
      if (!leadId) return 'add_note: skipped (no lead)';
      await prisma.leadActivity.create({ data: { organizationId, leadId, type: 'note', message: String(action.params?.message ?? 'Automation note') } });
      return 'add_note: recorded';
    }
    default:
      return `unknown action: ${(action as ActionDef).type}`;
  }
}
