import { prisma } from '@/lib/prisma';
import { withOrg, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  const logs = await prisma.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(sp.get('limit') ?? 100), 200),
  });
  return ok({ logs });
}, { minRole: 'ADMIN' });
