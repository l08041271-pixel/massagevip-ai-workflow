import { randomBytes, createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { forgotSchema } from '@/lib/validation';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req, 'forgot'), 5, 60_000);
    if (!rl.allowed) throw new AppError('Too many requests. Try again shortly.', 429, 'rate_limited');
    const body = forgotSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Always return success to avoid account enumeration.
    if (user) {
      const token = randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600_000) },
      });
      const link = `${env.appUrl}/reset-password?token=${token}`;
      await sendEmail({ to: user.email, subject: 'Reset your GrowthPilot AI password', text: `Reset your password: ${link}\nThis link expires in 1 hour.` });
    }
    return ok({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (e) {
    return errorResponse(e);
  }
}
