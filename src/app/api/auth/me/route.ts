import { getSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { errorResponse, ok } from '@/lib/errors';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ user: null, memberships: [] });
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: { organization: { include: { subscription: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return ok({
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        plan: m.organization.subscription?.plan ?? 'free',
        onboardingDone: m.organization.onboardingDone,
      })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
