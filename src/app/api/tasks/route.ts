import { prisma } from '@/lib/prisma';
import { withOrg, parseJson, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';
import { taskSchema } from '@/lib/validation';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  const tasks = await prisma.task.findMany({
    where: { organizationId: ctx.organizationId, ...(sp.get('completed') === 'true' ? { completed: true } : sp.get('completed') === 'false' ? { completed: false } : {}) },
    orderBy: [{ completed: 'asc' }, { dueAt: 'asc' }],
    take: 100,
  });
  return ok({ tasks });
});

export const POST = withOrg(async (req, ctx) => {
  const body = taskSchema.parse(await parseJson(req));
  const task = await prisma.task.create({
    data: {
      organizationId: ctx.organizationId,
      title: body.title,
      description: body.description ?? null,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      priority: body.priority,
      relatedLeadId: body.relatedLeadId ?? null,
    },
  });
  return ok({ task }, { status: 201 });
}, { write: true });

export const PATCH = withOrg(async (req, ctx) => {
  const body = (await parseJson<{ id: string; completed?: boolean }>(req)) ?? {};
  if (!body.id) return ok({ ok: false });
  await prisma.task.updateMany({ where: { id: body.id, organizationId: ctx.organizationId }, data: { completed: body.completed ?? true, completedAt: body.completed === false ? null : new Date() } });
  return ok({ ok: true });
}, { write: true });
