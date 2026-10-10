import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok } from '@/lib/errors';
import { billingStatus } from '@/lib/billing';
import { whatsappStatus } from '@/lib/whatsapp';
import { getAiProvider } from '@/lib/ai';
import { z } from 'zod';

export const GET = withOrg(async (_req, ctx) => {
  const settings = await prisma.integrationSetting.findMany({ where: { organizationId: ctx.organizationId } });
  const ai = getAiProvider();
  return ok({
    settings,
    capabilities: {
      ai: { provider: ai.name, demo: ai.demo },
      stripe: billingStatus(),
      whatsapp: whatsappStatus(),
    },
  });
});

export const POST = withOrg(async (req, ctx) => {
  const body = z.object({ provider: z.enum(['whatsapp', 'stripe', 'email', 'ai']), enabled: z.boolean(), config: z.record(z.any()).optional() }).parse(await parseJson(req));
  const setting = await prisma.integrationSetting.upsert({
    where: { organizationId_provider: { organizationId: ctx.organizationId, provider: body.provider } },
    create: { organizationId: ctx.organizationId, provider: body.provider, enabled: body.enabled, config: body.config ? JSON.stringify(body.config) : null, status: body.enabled ? 'configured' : 'unconfigured', lastCheckedAt: new Date() },
    update: { enabled: body.enabled, config: body.config ? JSON.stringify(body.config) : undefined, status: body.enabled ? 'configured' : 'unconfigured', lastCheckedAt: new Date() },
  });
  return ok({ setting });
}, { write: true, minRole: 'ADMIN' });
