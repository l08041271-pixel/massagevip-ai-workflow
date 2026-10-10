/**
 * Transparent, deterministic, testable lead-scoring engine.
 *
 * Design rules:
 *  - Never uses sensitive personal characteristics (age, gender, ethnicity,
 *    health, religion, etc.). Only business-intent signals.
 *  - Every point awarded is explained so the result is auditable.
 *  - Budget is only considered when voluntarily provided by the customer.
 *  - Output is bounded to 0..100 and mapped to a qualification category.
 */

export type ScoreCategory = 'HOT' | 'WARM' | 'COLD';

export interface ScoreInput {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  intent?: string | null;
  serviceInterest?: string | null;
  budget?: number | null;
  status?: string | null;
  activityCount?: number;
  lastContactedAt?: Date | string | null;
  createdAt?: Date | string | null;
  hasBooking?: boolean;
}

export interface ScoreReason {
  label: string;
  points: number;
}

export interface ScoreResult {
  score: number;
  category: ScoreCategory;
  explanation: string;
  reasons: ScoreReason[];
  recommendedAction: string;
}

const INTENT_KEYWORDS: Record<string, number> = {
  'ready to buy': 20,
  'request a quote': 18,
  'book': 18,
  'pricing': 12,
  'consultation': 12,
  'demo': 14,
  'quote': 16,
  'urgent': 12,
  'asap': 12,
  'interested': 8,
  'information': 4,
  'browsing': 0,
};

const HIGH_VALUE_SOURCES: Record<string, number> = {
  referral: 12,
  campaign: 8,
  website: 6,
  whatsapp: 8,
  social: 4,
  import: 2,
  manual: 3,
  other: 1,
};

const STAGE_POINTS: Record<string, number> = {
  NEW: 0,
  CONTACTED: 6,
  QUALIFIED: 12,
  BOOKED: 18,
  COMPLETED: 10,
  LOST: -15,
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function daysSince(d?: Date | string | null): number | null {
  if (!d) return null;
  const t = typeof d === 'string' ? new Date(d).getTime() : d.getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function scoreLead(input: ScoreInput): ScoreResult {
  const reasons: ScoreReason[] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) reasons.push({ label, points });
  };

  // --- Contact completeness (max 30) ---
  if (input.email) add('Email provided', 10);
  if (input.phone) add('Phone provided', 10);
  if (input.company) add('Company provided', 5);
  if (input.email && input.phone) add('Multiple contact channels', 5);

  // --- Intent (max 20) ---
  const intent = (input.intent ?? '').toLowerCase();
  let intentPoints = 0;
  for (const [kw, pts] of Object.entries(INTENT_KEYWORDS)) {
    if (intent.includes(kw)) intentPoints = Math.max(intentPoints, pts);
  }
  if (intentPoints > 0) add('Expressed purchase intent', intentPoints);

  // --- Service requirement clarity ---
  if (input.serviceInterest) add('Specified service interest', 8);

  // --- Budget, only when voluntarily provided (max 15) ---
  if (typeof input.budget === 'number' && input.budget > 0) {
    if (input.budget >= 5000) add('Budget range provided (high)', 15);
    else if (input.budget >= 1000) add('Budget range provided (mid)', 10);
    else add('Budget range provided', 6);
  }

  // --- Source quality ---
  const srcPts = input.source ? HIGH_VALUE_SOURCES[input.source] ?? 0 : 0;
  if (srcPts > 0) add(`Lead source: ${input.source}`, srcPts);

  // --- Stage ---
  const stagePts = input.status ? STAGE_POINTS[input.status] ?? 0 : 0;
  if (stagePts !== 0) add(`Pipeline stage: ${input.status}`, stagePts);

  // --- Engagement history (max 15) ---
  const activityCount = input.activityCount ?? 0;
  if (activityCount > 0) add('Has recorded activity', Math.min(10, activityCount * 2));
  const lastDays = daysSince(input.lastContactedAt);
  if (lastDays !== null && lastDays <= 3) add('Recently contacted', 5);
  else if (lastDays !== null && lastDays > 30) add('No contact in over 30 days', -5);

  // --- Booking readiness ---
  if (input.hasBooking) add('Booking already scheduled', 8);

  // --- Recency of creation ---
  const createdDays = daysSince(input.createdAt);
  if (createdDays !== null && createdDays <= 2) add('New lead', 4);

  const raw = reasons.reduce((sum, r) => sum + r.points, 0);
  const score = clamp(Math.round(raw));
  const category: ScoreCategory = score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD';

  const explanation = buildExplanation(score, category, reasons);
  const recommendedAction = recommendAction(category, input);

  return { score, category, explanation, reasons, recommendedAction };
}

function buildExplanation(score: number, category: ScoreCategory, reasons: ScoreReason[]): string {
  const positives = reasons.filter((r) => r.points > 0).sort((a, b) => b.points - a.points).slice(0, 4);
  const negatives = reasons.filter((r) => r.points < 0);
  const parts: string[] = [];
  parts.push(`Score ${score}/100 (${category}).`);
  if (positives.length) {
    parts.push('Strongest signals: ' + positives.map((r) => `${r.label} (+${r.points})`).join(', ') + '.');
  } else {
    parts.push('Limited positive signals recorded so far.');
  }
  if (negatives.length) {
    parts.push('Risk factors: ' + negatives.map((r) => `${r.label} (${r.points})`).join(', ') + '.');
  }
  return parts.join(' ');
}

function recommendAction(category: ScoreCategory, input: ScoreInput): string {
  if (input.status === 'LOST') return 'Mark as nurture; revisit in 90 days with a re-engagement offer.';
  if (input.hasBooking) return 'Confirm the upcoming booking and send a reminder 24h before.';
  switch (category) {
    case 'HOT':
      return 'Call within 1 hour and offer to book a consultation now.';
    case 'WARM':
      return 'Send a personalised follow-up and propose two time slots for a call.';
    default:
      return 'Add to a nurture sequence and re-score after the next interaction.';
  }
}

export function categoryFromScore(score: number): ScoreCategory {
  return score >= 70 ? 'HOT' : score >= 40 ? 'WARM' : 'COLD';
}
