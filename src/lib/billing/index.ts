import { env, hasStripeCredentials } from '@/lib/env';
import { getPlan, type PlanId } from '@/lib/plans';

export interface CheckoutResult {
  ok: boolean;
  url?: string;
  mock?: boolean;
  error?: string;
}

/**
 * Billing adapter. When Stripe credentials are present we create a real
 * Checkout Session via the Stripe REST API (no SDK dependency). Otherwise we
 * return a clearly-labelled mock so the flow can be exercised locally.
 * We NEVER fabricate a successful payment confirmation.
 */
export async function createCheckoutSession(params: {
  plan: PlanId;
  organizationId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutResult> {
  const plan = getPlan(params.plan);
  if (plan.id === 'free') return { ok: false, error: 'The Free plan does not require checkout.' };

  if (!hasStripeCredentials()) {
    return { ok: false, mock: true, error: 'Billing is not configured. Set STRIPE_SECRET_KEY and price IDs to enable checkout.' };
  }

  const priceId = plan.stripePriceEnv ? process.env[plan.stripePriceEnv] : undefined;
  if (!priceId) {
    return { ok: false, error: `Missing Stripe price id for plan ${plan.id} (${plan.stripePriceEnv}).` };
  }

  try {
    const body = new URLSearchParams();
    body.set('mode', 'subscription');
    body.set('line_items[0][price]', priceId);
    body.set('line_items[0][quantity]', '1');
    body.set('success_url', params.successUrl);
    body.set('cancel_url', params.cancelUrl);
    body.set('customer_email', params.customerEmail);
    body.set('client_reference_id', params.organizationId);
    body.set('metadata[organizationId]', params.organizationId);
    body.set('metadata[plan]', plan.id);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      return { ok: false, error: json.error?.message ?? `Stripe error (${res.status})` };
    }
    return { ok: true, url: json.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Stripe request failed' };
  }
}

export function billingStatus() {
  return {
    configured: hasStripeCredentials(),
    webhookConfigured: Boolean(env.stripe.webhookSecret),
    prices: {
      starter: Boolean(env.stripe.priceStarter),
      pro: Boolean(env.stripe.pricePro),
      agency: Boolean(env.stripe.priceAgency),
    },
  };
}
