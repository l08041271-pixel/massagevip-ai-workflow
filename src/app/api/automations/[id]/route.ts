import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok, NotFound } from '@/lib/errors';
import { z } from 'zod';

const patchSchema = z.object({ enabled: z.boolean().optional(), paused: z.boolean().optional(), name: z.string().min(1).max(160).optional(), actions: z.array(z.any()).optional(), conditions: z.record(z.any()).nullable().optional(), maxRetries: z.number().int().min(0).max(10).optional() });

export const PATCH = withOrg(async (req, ctx, params) => {
  const existing = await prisma.automationRule.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!existing) throw NotFound('Automation rule not found');
  const body = patchSchema.parse(await parseJson(req));
  const rule = await prisma.automationRule.update({
    where: { id: existing.id },
    data: {
      enabled: body.enabled,
      paused: body.paused,
      name: body.name,
      maxRetries: body.maxRetries,
      actions: body.actions ? JSON.stringify(body.actions) : undefined,
      conditions: body.conditions === undefined ? undefined : body.conditions ? JSON.stringify(body.conditions) : null,
    },
  });
  return ok({ rule: { ...rule, actions: JSON.parse(rule.actions) } });
}, { write: true });

export const DELETE = withOrg(async (_req, ctx, params) => {
  const existing = await prisma.automationRule.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!existing) throw NotFound('Automation rule not found');
  await prisma.automationRule.delete({ where: { id: existing.id } });
  return ok({ ok: true });
}, { write: true });
