import { prisma } from '@/lib/prisma';
import { loginSchema } from '@/lib/validation';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req, 'login'), 10, 60_000);
    if (!rl.allowed) throw new AppError('Too many login attempts. Try again shortly.', 429, 'rate_limited');
    const body = loginSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Constant-ish response to avoid user enumeration.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new AppError('Incorrect email or password', 401, 'invalid_credentials');
    }
    await createSession(user.id, { ip: clientKey(req, 'ip').split(':')[1], userAgent: req.headers.get('user-agent') ?? undefined });
    await audit({ actorId: user.id, action: 'user.login', entity: 'user', entityId: user.id });
    return ok({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (e) {
    return errorResponse(e);
  }
}
