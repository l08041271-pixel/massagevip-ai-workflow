import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok, NotFound } from '@/lib/errors';
import { leadUpdateSchema } from '@/lib/validation';
import { scoreAndPersist } from '@/lib/leads';
import { dispatch } from '@/lib/automation/engine';
import { audit } from '@/lib/audit';

export const GET = withOrg(async (_req, ctx, params) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params!.id, organizationId: ctx.organizationId },
    include: { activities: { orderBy: { createdAt: 'desc' } }, bookings: true, campaign: true },
  });
  if (!lead) throw NotFound('Lead not found');
  return ok({ lead, scoreReasons: lead.scoreReasons ? JSON.parse(lead.scoreReasons) : [] });
});

export const PATCH = withOrg(async (req, ctx, params) => {
  const existing = await prisma.lead.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!existing) throw NotFound('Lead not found');
  const body = leadUpdateSchema.parse(await parseJson(req));
  const statusChanged = body.status && body.status !== existing.status;

  const lead = await prisma.lead.update({
    where: { id: existing.id },
    data: {
      ...body,
      followUpAt: body.followUpAt ? new Date(body.followUpAt) : undefined,
      budget: body.budget ?? undefined,
      lastContactedAt: statusChanged && body.status !== 'NEW' ? new Date() : undefined,
    },
  });
  if (statusChanged) {
    await prisma.leadActivity.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, type: 'status_change', message: `Status changed ${existing.status} → ${body.status}`, actorId: ctx.userId } });
  }
  const score = await scoreAndPersist(ctx.organizationId, lead.id);
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: 'lead.updated', entity: 'lead', entityId: lead.id });
  if (statusChanged) {
    await dispatch({ organizationId: ctx.organizationId, trigger: 'lead.status_changed', entityId: lead.id, leadId: lead.id, actorId: ctx.userId, payload: { status: body.status, category: score.category } }).catch(() => undefined);
  }
  return ok({ lead: await prisma.lead.findUnique({ where: { id: lead.id } }), score });
}, { write: true });

export const DELETE = withOrg(async (_req, ctx, params) => {
  const existing = await prisma.lead.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!existing) throw NotFound('Lead not found');
  await prisma.lead.delete({ where: { id: existing.id } });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: 'lead.deleted', entity: 'lead', entityId: existing.id });
  return ok({ ok: true });
}, { write: true });
