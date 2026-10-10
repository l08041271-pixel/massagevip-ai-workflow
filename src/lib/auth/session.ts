import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'gp_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, ip: meta?.ip, userAgent: meta?.userAgent },
  });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
  return token;
}

export async function getSessionUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function destroySession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookies().delete(SESSION_COOKIE);
}

export async function destroyAllUserSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
