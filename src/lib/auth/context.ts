import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { Forbidden, Unauthorized } from '@/lib/errors';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
const ROLE_RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, VIEWER: 1 };

export interface OrgContext {
  userId: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  plan: string;
}

/**
 * Resolve the authenticated user and the organization they are acting on.
 * The organization id MUST come from the request (header/cookie) and is then
 * verified against the user's membership. This is the single choke point that
 * guarantees tenant isolation server-side.
 */
export async function requireOrg(orgIdFromRequest?: string | null): Promise<OrgContext> {
  const user = await getSessionUser();
  if (!user) throw Unauthorized();

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { organization: { include: { subscription: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (memberships.length === 0) throw Forbidden('No workspace found for this account');

  const membership =
    (orgIdFromRequest && memberships.find((m) => m.organizationId === orgIdFromRequest)) || memberships[0];

  if (!membership) throw Forbidden('You do not have access to that workspace');

  return {
    userId: user.id,
    userEmail: user.email,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    role: membership.role as Role,
    plan: membership.organization.subscription?.plan ?? 'free',
  };
}

export function requireRole(ctx: OrgContext, min: Role) {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    throw Forbidden(`This action requires the ${min} role or higher`);
  }
}

export function canWrite(ctx: OrgContext) {
  return ROLE_RANK[ctx.role] >= ROLE_RANK.MEMBER;
}

/** Resolve org id from request headers for API routes. */
export function orgIdFromRequest(req: Request): string | null {
  return req.headers.get('x-org-id');
}
