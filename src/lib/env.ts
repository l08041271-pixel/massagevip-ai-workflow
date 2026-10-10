/**
 * Centralized, validated environment access. Secrets are only ever read here
 * and on the server. Nothing in this module is imported by client components.
 */
function opt(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  authSecret: process.env.AUTH_SECRET ?? '',
  isProd: process.env.NODE_ENV === 'production',

  ai: {
    provider: opt('AI_PROVIDER') ?? 'demo',
    apiKey: opt('AI_API_KEY'),
    model: opt('AI_MODEL') ?? 'gpt-4o-mini',
    baseUrl: opt('AI_BASE_URL') ?? 'https://api.openai.com/v1',
  },

  stripe: {
    secretKey: opt('STRIPE_SECRET_KEY'),
    webhookSecret: opt('STRIPE_WEBHOOK_SECRET'),
    priceStarter: opt('STRIPE_PRICE_STARTER'),
    pricePro: opt('STRIPE_PRICE_PRO'),
    priceAgency: opt('STRIPE_PRICE_AGENCY'),
  },

  whatsapp: {
    accessToken: opt('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: opt('WHATSAPP_PHONE_NUMBER_ID'),
    verifyToken: opt('WHATSAPP_VERIFY_TOKEN'),
    appSecret: opt('WHATSAPP_APP_SECRET'),
  },

  email: { provider: opt('EMAIL_PROVIDER') ?? 'log' },
};

export function assertAuthSecret() {
  if (!env.authSecret || env.authSecret.length < 16) {
    if (env.isProd) throw new Error('AUTH_SECRET must be set to a strong value in production');
  }
}

export function hasAiCredentials() {
  return Boolean(env.ai.apiKey) && env.ai.provider !== 'demo';
}
export function hasStripeCredentials() {
  return Boolean(env.stripe.secretKey);
}
export function hasWhatsAppCredentials() {
  return Boolean(env.whatsapp.accessToken && env.whatsapp.phoneNumberId);
}
