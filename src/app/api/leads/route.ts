import { prisma } from '@/lib/prisma';
import { withOrg, parseJson, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';
import { leadCreateSchema, leadListQuerySchema } from '@/lib/validation';
import { createLead, findDuplicates } from '@/lib/leads';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';

export const GET = withOrg(async (req, ctx) => {
  const q = leadListQuerySchema.parse(Object.fromEntries(searchParams(req)));
  const where: Record<string, unknown> = { organizationId: ctx.organizationId, archived: false };
  if (q.status) where.status = q.status;
  if (q.source) where.source = q.source;
  if (q.category) where.scoreCategory = q.category;
  if (q.campaignId) where.campaignId = q.campaignId;
  if (q.q) {
    where.OR = [
      { name: { contains: q.q } },
      { email: { contains: q.q } },
      { phone: { contains: q.q } },
      { company: { contains: q.q } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { [q.sort]: q.order },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.lead.count({ where }),
  ]);
  return ok({ items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
});

export const POST = withOrg(async (req, ctx) => {
  const rl = rateLimit(clientKey(req, `lead-create:${ctx.organizationId}`), 60, 60_000);
  if (!rl.allowed) throw new AppError('Too many leads created. Please slow down.', 429, 'rate_limited');
  const body = leadCreateSchema.parse(await parseJson(req));
  const duplicates = await findDuplicates(ctx.organizationId, body);
  const result = await createLead({ organizationId: ctx.organizationId, actorId: ctx.userId, plan: ctx.plan, input: body });
  return ok({ lead: result.lead, score: result.score, possibleDuplicates: duplicates }, { status: 201 });
}, { write: true });
