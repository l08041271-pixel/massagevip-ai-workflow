import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { resetSchema } from '@/lib/validation';
import { hashPassword } from '@/lib/auth/password';
import { destroyAllUserSessions } from '@/lib/auth/session';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req, 'reset'), 10, 60_000);
    if (!rl.allowed) throw new AppError('Too many requests. Try again shortly.', 429, 'rate_limited');
    const body = resetSchema.parse(await req.json());
    const tokenHash = createHash('sha256').update(body.token).digest('hex');
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new AppError('This reset link is invalid or has expired', 400, 'invalid_token');
    }
    await prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(body.password) } });
    await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    await destroyAllUserSessions(record.userId);
    await audit({ actorId: record.userId, action: 'user.password_reset', entity: 'user', entityId: record.userId });
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
