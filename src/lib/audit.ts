import { prisma } from '@/lib/prisma';

export async function audit(params: {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.organizationId ?? null,
        actorId: params.actorId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        meta: params.meta ? JSON.stringify(params.meta) : null,
        ip: params.ip,
      },
    });
  } catch (e) {
    // Audit logging must never break the primary operation.
    console.error('[audit] failed to record', params.action, e);
  }
}
