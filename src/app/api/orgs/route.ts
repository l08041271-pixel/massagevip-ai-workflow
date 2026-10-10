import { prisma } from '@/lib/prisma';
import { getSessionUser } from '@/lib/auth/session';
import { orgCreateSchema } from '@/lib/validation';
import { errorResponse, ok, Unauthorized, AppError } from '@/lib/errors';
import { uniqueSlug } from '@/lib/slug';
import { audit } from '@/lib/audit';
import { rateLimit, clientKey } from '@/lib/rate-limit';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) throw Unauthorized();
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: { organization: { include: { subscription: true } } },
    });
    return ok({ organizations: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name, slug: m.organization.slug, role: m.role, plan: m.organization.subscription?.plan ?? 'free' })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req, 'org-create'), 10, 60_000);
    if (!rl.allowed) throw new AppError('Too many requests. Try again shortly.', 429, 'rate_limited');
    const user = await getSessionUser();
    if (!user) throw Unauthorized();
    const body = orgCreateSchema.parse(await req.json());
    const slug = await uniqueSlug(body.name, async (s) => Boolean(await prisma.organization.findUnique({ where: { slug: s } })));

    const org = await prisma.organization.create({
      data: {
        name: body.name,
        slug,
        industry: body.industry || null,
        subscription: { create: { plan: 'free', status: 'active' } },
        memberships: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    await audit({ organizationId: org.id, actorId: user.id, action: 'org.created', entity: 'organization', entityId: org.id });
    return ok({ organization: { id: org.id, name: org.name, slug: org.slug } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

