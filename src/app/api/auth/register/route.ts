import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req, 'register'), 10, 60_000);
    if (!rl.allowed) throw new AppError('Too many attempts. Try again shortly.', 429, 'rate_limited');
    const body = registerSchema.parse(await req.json());
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new AppError('An account with that email already exists', 409, 'email_taken');

    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) },
    });
    await createSession(user.id, { ip: clientKey(req, 'ip').split(':')[1], userAgent: req.headers.get('user-agent') ?? undefined });
    await audit({ actorId: user.id, action: 'user.registered', entity: 'user', entityId: user.id });
    return ok({ user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

