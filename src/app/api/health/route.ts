import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/errors';
import { hasAiCredentials, hasStripeCredentials, hasWhatsAppCredentials } from '@/lib/env';

export async function GET() {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return ok(
    {
      status: dbOk ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      checks: { database: dbOk },
      integrations: { ai: hasAiCredentials() ? 'configured' : 'demo', stripe: hasStripeCredentials() ? 'configured' : 'unconfigured', whatsapp: hasWhatsAppCredentials() ? 'configured' : 'mock' },
    },
    { status: dbOk ? 200 : 503 },
  );
}
