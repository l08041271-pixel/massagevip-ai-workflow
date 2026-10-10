import { withOrg, parseJson } from '@/lib/api';
import { ok, AppError } from '@/lib/errors';
import { getAiProvider } from '@/lib/ai';
import { prisma } from '@/lib/prisma';
import { getPlan } from '@/lib/plans';
import { z } from 'zod';

const schema = z.object({
  task: z.enum(['summary', 'followups', 'draft_message', 'campaign_analysis', 'recommendations', 'weekly_summary', 'ask']),
  prompt: z.string().max(4000).optional(),
  leadId: z.string().optional(),
});

export const POST = withOrg(async (req, ctx) => {
  const body = schema.parse(await parseJson(req));

  // Enforce plan AI usage limits.
  const limit = getPlan(ctx.plan).limits.aiRequestsPerMonth;
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const used = await prisma.usageRecord.aggregate({
    where: { organizationId: ctx.organizationId, metric: 'ai_requests', periodStart: { gte: periodStart } },
    _sum: { quantity: true },
  });
  if (limit !== -1 && (used._sum.quantity ?? 0) >= limit) {
    throw new AppError(`AI request limit reached for the ${getPlan(ctx.plan).name} plan this month.`, 403, 'plan_limit');
  }

  // Build grounded context from real workspace data.
  const context = await buildContext(ctx.organizationId, body.leadId);
  const provider = getAiProvider();
  const messages = [
    { role: 'system' as const, content: 'You are GrowthPilot AI, a concise business assistant for small service businesses. Only use the provided workspace data. Never invent metrics or customer details.' },
    { role: 'user' as const, content: `Task: ${body.task}\n\nWorkspace data:\n${context}\n\n${body.prompt ? `Additional request: ${body.prompt}` : ''}` },
  ];
  const result = await provider.complete(messages, { maxTokens: 900 });

  await prisma.usageRecord.create({ data: { organizationId: ctx.organizationId, metric: 'ai_requests', quantity: 1 } });

  if (!result.ok) {
    // Surface the real failure instead of pretending it worked.
    return ok({ ok: false, demo: result.demo, provider: result.provider, error: result.error ?? 'AI request failed' }, { status: 502 });
  }
  return ok({ ok: true, text: result.text, demo: result.demo, provider: result.provider, model: result.model });
}, { rate: { limit: 30, windowMs: 60_000, scope: 'ai' } });

async function buildContext(organizationId: string, leadId?: string) {
  if (leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId }, include: { activities: { orderBy: { createdAt: 'desc' }, take: 10 } } });
    if (lead) {
      return JSON.stringify({
        lead: { name: lead.name, status: lead.status, score: lead.score, category: lead.scoreCategory, source: lead.source, serviceInterest: lead.serviceInterest, budget: lead.budget, recommendedAction: lead.recommendedAction, followUpAt: lead.followUpAt },
        recentActivity: lead.activities.map((a) => ({ type: a.type, message: a.message, at: a.createdAt })),
      }, null, 2);
    }
  }
  const [byStatus, hot, bookings, campaigns] = await Promise.all([
    prisma.lead.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.lead.count({ where: { organizationId, scoreCategory: 'HOT', archived: false } }),
    prisma.booking.count({ where: { organizationId, status: 'scheduled', scheduledAt: { gte: new Date() } } }),
    prisma.campaign.findMany({ where: { organizationId }, select: { name: true, channel: true, status: true, budget: true }, take: 10 }),
  ]);
  return JSON.stringify({ leadsByStatus: byStatus, hotLeads: hot, upcomingBookings: bookings, campaigns }, null, 2);
}
