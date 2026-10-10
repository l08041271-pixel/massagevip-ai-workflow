/**
 * Configurable pricing + plan limits. Change values here (or override via env)
 * rather than hardcoding throughout the app.
 */
export type PlanId = 'free' | 'starter' | 'pro' | 'agency';

export interface PlanLimits {
  leads: number;          // -1 = unlimited
  members: number;
  automations: number;
  aiRequestsPerMonth: number;
  whatsappMessagesPerMonth: number;
  campaigns: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number; // USD
  priceYearly: number;
  tagline: string;
  features: string[];
  limits: PlanLimits;
  stripePriceEnv?: string;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    tagline: 'Get started capturing leads',
    features: ['Up to 50 leads', '1 team member', '1 automation rule', 'Basic dashboard'],
    limits: { leads: 50, members: 1, automations: 1, aiRequestsPerMonth: 25, whatsappMessagesPerMonth: 0, campaigns: 1 },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 29,
    priceYearly: 290,
    tagline: 'For solo operators and new businesses',
    features: ['Up to 1,000 leads', '3 team members', '5 automation rules', 'AI assistant', 'WhatsApp integration'],
    limits: { leads: 1000, members: 3, automations: 5, aiRequestsPerMonth: 500, whatsappMessagesPerMonth: 500, campaigns: 10 },
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 79,
    priceYearly: 790,
    tagline: 'For growing service businesses',
    features: ['Up to 10,000 leads', '10 team members', 'Unlimited automations', 'Advanced reporting', 'Priority support'],
    limits: { leads: 10000, members: 10, automations: -1, aiRequestsPerMonth: 5000, whatsappMessagesPerMonth: 5000, campaigns: 50 },
    stripePriceEnv: 'STRIPE_PRICE_PRO',
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceMonthly: 199,
    priceYearly: 1990,
    tagline: 'For agencies managing multiple clients',
    features: ['Unlimited leads', 'Unlimited members', 'Unlimited automations', 'Multi-workspace', 'White-label ready', 'Dedicated support'],
    limits: { leads: -1, members: -1, automations: -1, aiRequestsPerMonth: 50000, whatsappMessagesPerMonth: 50000, campaigns: -1 },
    stripePriceEnv: 'STRIPE_PRICE_AGENCY',
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'starter', 'pro', 'agency'];

export function getPlan(id: string): Plan {
  return PLANS[(id as PlanId)] ?? PLANS.free;
}

export function isWithinLimit(plan: PlanId, metric: keyof PlanLimits, current: number) {
  const limit = PLANS[plan].limits[metric];
  if (limit === -1) return true;
  return current < limit;
}

export function limitFor(plan: PlanId, metric: keyof PlanLimits) {
  return PLANS[plan].limits[metric];
}
