import { withOrg, parseJson } from '@/lib/api';
import { ok, AppError } from '@/lib/errors';
import { createCheckoutSession } from '@/lib/billing';
import { env } from '@/lib/env';
import { z } from 'zod';

const schema = z.object({ plan: z.enum(['starter', 'pro', 'agency']) });

export const POST = withOrg(async (req, ctx) => {
  const body = schema.parse(await parseJson(req));
  const result = await createCheckoutSession({
    plan: body.plan,
    organizationId: ctx.organizationId,
    customerEmail: ctx.userEmail,
    successUrl: `${env.appUrl}/dashboard/billing?checkout=success`,
    cancelUrl: `${env.appUrl}/dashboard/billing?checkout=cancelled`,
  });
  if (!result.ok) throw new AppError(result.error ?? 'Checkout unavailable', result.mock ? 503 : 400, result.mock ? 'billing_unconfigured' : 'checkout_failed');
  return ok({ url: result.url });
}, { write: true, minRole: 'ADMIN' });
