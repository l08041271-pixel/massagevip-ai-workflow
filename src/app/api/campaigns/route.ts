import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok } from '@/lib/errors';
import { campaignSchema } from '@/lib/validation';
import { getPlan } from '@/lib/plans';
import { AppError } from '@/lib/errors';

export const GET = withOrg(async (_req, ctx) => {
  const campaigns = await prisma.campaign.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: 'desc' } });
  return ok({ campaigns });
});

export const POST = withOrg(async (req, ctx) => {
  const limit = getPlan(ctx.plan).limits.campaigns;
  if (limit !== -1) {
    const count = await prisma.campaign.count({ where: { organizationId: ctx.organizationId } });
    if (count >= limit) throw new AppError(`Your ${getPlan(ctx.plan).name} plan allows ${limit} campaigns. Upgrade for more.`, 403, 'plan_limit');
  }
  const body = campaignSchema.parse(await parseJson(req));
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name,
      channel: body.channel,
      status: body.status,
      budget: body.budget ?? null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
    },
  });
  return ok({ campaign }, { status: 201 });
}, { write: true });
