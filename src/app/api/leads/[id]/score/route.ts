import { withOrg } from '@/lib/api';
import { ok, NotFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { scoreAndPersist } from '@/lib/leads';

export const POST = withOrg(async (_req, ctx, params) => {
  const lead = await prisma.lead.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!lead) throw NotFound('Lead not found');
  const result = await scoreAndPersist(ctx.organizationId, lead.id);
  await prisma.leadActivity.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, type: 'score', message: `Re-scored ${result.score}/100 (${result.category})`, meta: JSON.stringify(result.reasons), actorId: ctx.userId } });
  return ok({ score: result });
}, { write: true });
