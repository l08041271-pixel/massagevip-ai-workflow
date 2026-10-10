import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok, NotFound } from '@/lib/errors';
import { z } from 'zod';
import { dispatch } from '@/lib/automation/engine';

const schema = z.object({ type: z.enum(['note', 'message', 'email', 'call']), message: z.string().min(1).max(5000) });

export const POST = withOrg(async (req, ctx, params) => {
  const lead = await prisma.lead.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!lead) throw NotFound('Lead not found');
  const body = schema.parse(await parseJson(req));
  const activity = await prisma.leadActivity.create({
    data: { organizationId: ctx.organizationId, leadId: lead.id, type: body.type, message: body.message, actorId: ctx.userId },
  });
  await prisma.lead.updateMany({ where: { id: lead.id, organizationId: ctx.organizationId }, data: { lastContactedAt: new Date() } });
  await dispatch({ organizationId: ctx.organizationId, trigger: 'lead.follow_up_due', entityId: lead.id, leadId: lead.id, actorId: ctx.userId, payload: { type: body.type } }).catch(() => undefined);
  return ok({ activity }, { status: 201 });
}, { write: true });
