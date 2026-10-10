import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { verifyWebhookSignature, verifyWebhookToken } from '@/lib/whatsapp';
import { dispatch } from '@/lib/automation/engine';

/** Webhook verification handshake (Meta Cloud API). */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get('hub.mode');
  const token = sp.get('hub.verify_token');
  const challenge = sp.get('hub.challenge');
  if (verifyWebhookToken(mode, token)) return new Response(challenge ?? '', { status: 200 });
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    if (process.env.WHATSAPP_APP_SECRET && !verifyWebhookSignature(raw, signature)) {
      throw new AppError('Invalid webhook signature', 401, 'invalid_signature');
    }
    const payload = JSON.parse(raw) as Record<string, any>;
    const externalId = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ?? createHash('sha256').update(raw).digest('hex');

    // Deduplicate webhook deliveries.
    const existing = await prisma.webhookEvent.findUnique({ where: { provider_externalId: { provider: 'whatsapp', externalId } } });
    if (existing?.processed) return ok({ received: true, duplicate: true });
    await prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: 'whatsapp', externalId } },
      create: { provider: 'whatsapp', externalId, payload: raw },
      update: {},
    });

    const value = payload?.entry?.[0]?.changes?.[0]?.value ?? {};
    const message = value?.messages?.[0];
    const fromPhone = message?.from as string | undefined;
    const text = message?.text?.body as string | undefined;
    const statuses = value?.statuses?.[0];

    if (statuses) {
      // Delivery status update — log it, do not fabricate delivery.
      console.info(`[whatsapp] status ${statuses.status} for ${statuses.id}`);
    }

    if (fromPhone) {
      // Route to the organization that owns this integration (first configured org).
      const integration = await prisma.integrationSetting.findFirst({ where: { provider: 'whatsapp', enabled: true }, include: { organization: true } });
      if (integration) {
        const lead = await prisma.lead.findFirst({ where: { organizationId: integration.organizationId, phone: fromPhone } });
        await dispatch({
          organizationId: integration.organizationId,
          trigger: 'lead.created',
          entityId: lead?.id,
          leadId: lead?.id,
          payload: { channel: 'whatsapp', hasMessage: Boolean(text) },
        }).catch(() => undefined);
      }
    }

    await prisma.webhookEvent.update({ where: { provider_externalId: { provider: 'whatsapp', externalId } }, data: { processed: true } });
    return ok({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
}
