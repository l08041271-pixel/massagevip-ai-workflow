import { prisma } from '@/lib/prisma';
import { withOrg, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  const take = Math.min(Number(sp.get('limit') ?? 50), 100);
  const executions = await prisma.automationExecution.findMany({
    where: { organizationId: ctx.organizationId, ...(sp.get('status') ? { status: sp.get('status')! } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    include: { rule: { select: { name: true } } },
  });
  return ok({ executions });
});
