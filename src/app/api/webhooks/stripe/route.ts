import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';

/** Verify a Stripe webhook signature (t=...,v1=...). */
function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = parts['t'];
  const sig = parts['v1'];
  if (!timestamp || !sig) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (!env.stripe.webhookSecret) {
      throw new AppError('Stripe webhooks are not configured on this deployment.', 503, 'billing_unconfigured');
    }
    if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), env.stripe.webhookSecret)) {
      throw new AppError('Invalid webhook signature', 400, 'invalid_signature');
    }
    const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };

    // Idempotency: ignore duplicate events.
    const existing = await prisma.webhookEvent.findUnique({ where: { provider_externalId: { provider: 'stripe', externalId: event.id } } });
    if (existing?.processed) return ok({ received: true, duplicate: true });
    await prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: 'stripe', externalId: event.id } },
      create: { provider: 'stripe', externalId: event.id, payload: raw },
      update: {},
    });

    const obj = event.data.object as Record<string, any>;
    const organizationId = (obj.metadata?.organizationId as string) ?? (obj.client_reference_id as string) ?? undefined;

    switch (event.type) {
      case 'checkout.session.completed':
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        if (organizationId) {
          const plan = (obj.metadata?.plan as string) ?? 'starter';
          await prisma.subscription.upsert({
            where: { organizationId },
            create: { organizationId, plan, status: 'active', stripeCustomerId: obj.customer as string, stripeSubscriptionId: obj.subscription as string },
            update: { plan, status: 'active', stripeCustomerId: obj.customer as string, stripeSubscriptionId: obj.subscription as string },
          });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        if (organizationId) {
          await prisma.subscription.update({ where: { organizationId }, data: { plan: 'free', status: 'canceled' } });
        }
        break;
      }
      case 'invoice.payment_failed': {
        if (organizationId) {
          await prisma.subscription.update({ where: { organizationId }, data: { status: 'past_due' } });
        }
        break;
      }
      default:
        break;
    }

    await prisma.webhookEvent.update({ where: { provider_externalId: { provider: 'stripe', externalId: event.id } }, data: { processed: true } });
    await audit({ organizationId, action: `billing.webhook.${event.type}`, entity: 'subscription', meta: { eventId: event.id } });
    return ok({ received: true });
  } catch (e) {
    return errorResponse(e);
  }
}
