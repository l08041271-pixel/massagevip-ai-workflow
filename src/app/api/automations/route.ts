import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok, AppError } from '@/lib/errors';
import { automationRuleSchema } from '@/lib/validation';
import { getPlan } from '@/lib/plans';
import { audit } from '@/lib/audit';

export const GET = withOrg(async (_req, ctx) => {
  const rules = await prisma.automationRule.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: 'desc' } });
  return ok({ rules: rules.map((r) => ({ ...r, actions: JSON.parse(r.actions), conditions: r.conditions ? JSON.parse(r.conditions) : null })) });
});

export const POST = withOrg(async (req, ctx) => {
  const limit = getPlan(ctx.plan).limits.automations;
  if (limit !== -1) {
    const count = await prisma.automationRule.count({ where: { organizationId: ctx.organizationId } });
    if (count >= limit) throw new AppError(`Your ${getPlan(ctx.plan).name} plan allows ${limit} automation rules. Upgrade for more.`, 403, 'plan_limit');
  }
  const body = automationRuleSchema.parse(await parseJson(req));
  const rule = await prisma.automationRule.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.name,
      trigger: body.trigger,
      conditions: body.conditions ? JSON.stringify(body.conditions) : null,
      actions: JSON.stringify(body.actions),
      enabled: body.enabled,
      maxRetries: body.maxRetries,
    },
  });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: 'automation.created', entity: 'automationRule', entityId: rule.id });
  return ok({ rule: { ...rule, actions: JSON.parse(rule.actions) } }, { status: 201 });
}, { write: true });
