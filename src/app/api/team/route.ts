import { prisma } from '@/lib/prisma';
import { withOrg } from '@/lib/api';
import { ok } from '@/lib/errors';

export const GET = withOrg(async (_req, ctx) => {
  const members = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return ok({ members: members.map((m) => ({ id: m.id, role: m.role, user: m.user, joinedAt: m.createdAt })) });
});
