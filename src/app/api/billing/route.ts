import { withOrg, parseJson } from '@/lib/api';
import { ok } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { billingStatus } from '@/lib/billing';
import { getPlan, PLANS } from '@/lib/plans';

export const GET = withOrg(async (_req, ctx) => {
  const sub = await prisma.subscription.findUnique({ where: { organizationId: ctx.organizationId } });
  const periodStart = new Date();
  periodStart.setDate(1);
  periodStart.setHours(0, 0, 0, 0);
  const usage = await prisma.usageRecord.groupBy({ by: ['metric'], where: { organizationId: ctx.organizationId, periodStart: { gte: periodStart } }, _sum: { quantity: true } });
  return ok({
    subscription: sub,
    plan: getPlan(sub?.plan ?? 'free'),
    plans: PLANS,
    provider: billingStatus(),
    usage: usage.map((u) => ({ metric: u.metric, quantity: u._sum.quantity ?? 0 })),
  });
});

export const POST = withOrg(async (req, ctx) => {
  // Mock plan change used only when Stripe is not configured (documented).
  const body = (await parseJson<{ plan?: string }>(req)) ?? {};
  const plan = body.plan ?? 'free';
  const sub = await prisma.subscription.upsert({
    where: { organizationId: ctx.organizationId },
    create: { organizationId: ctx.organizationId, plan, status: 'active' },
    update: { plan, status: 'active' },
  });
  return ok({ subscription: sub, note: 'Plan updated locally. Configure Stripe for real billing.' });
}, { write: true, minRole: 'ADMIN' });
