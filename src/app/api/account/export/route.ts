import { prisma } from '@/lib/prisma';
import { withOrg } from '@/lib/api';
import { ok } from '@/lib/errors';
import { audit } from '@/lib/audit';

/** Data export: returns all organization-owned data as JSON (GDPR portability). */
export const GET = withOrg(async (_req, ctx) => {
  const orgId = ctx.organizationId;
  const [organization, leads, activities, campaigns, bookings, automations, executions, tasks, events, auditLogs] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId } }),
    prisma.lead.findMany({ where: { organizationId: orgId } }),
    prisma.leadActivity.findMany({ where: { organizationId: orgId } }),
    prisma.campaign.findMany({ where: { organizationId: orgId } }),
    prisma.booking.findMany({ where: { organizationId: orgId } }),
    prisma.automationRule.findMany({ where: { organizationId: orgId } }),
    prisma.automationExecution.findMany({ where: { organizationId: orgId } }),
    prisma.task.findMany({ where: { organizationId: orgId } }),
    prisma.marketingEvent.findMany({ where: { organizationId: orgId } }),
    prisma.auditLog.findMany({ where: { organizationId: orgId } }),
  ]);
  await audit({ organizationId: orgId, actorId: ctx.userId, action: 'account.exported', entity: 'organization', entityId: orgId });
  return ok({ exportedAt: new Date().toISOString(), organization, leads, activities, campaigns, bookings, automations, executions, tasks, events, auditLogs }, { headers: { 'Content-Disposition': 'attachment; filename="growthpilot-export.json"' } });
}, { minRole: 'OWNER' });
