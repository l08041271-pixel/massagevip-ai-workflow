import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const forgotSchema = z.object({ email: emailSchema });
export const resetSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const orgCreateSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name is required').max(120),
  industry: z.string().trim().max(120).optional().or(z.literal('')),
});

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'BOOKED', 'COMPLETED', 'LOST'] as const;
export const LEAD_SOURCES = ['website', 'referral', 'whatsapp', 'campaign', 'manual', 'import', 'social', 'other'] as const;

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

export const leadCreateSchema = z.object({
  name: z.string().trim().min(1, 'Lead name is required').max(160),
  email: z.preprocess(emptyToUndef, emailSchema.optional()),
  phone: z.preprocess(emptyToUndef, z.string().trim().max(40).optional()),
  company: z.preprocess(emptyToUndef, z.string().trim().max(160).optional()),
  source: z.enum(LEAD_SOURCES).optional(),
  campaignId: z.preprocess(emptyToUndef, z.string().optional()),
  utmSource: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  utmMedium: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  utmCampaign: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  intent: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  serviceInterest: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  budget: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().nonnegative().max(10_000_000).optional()),
  notes: z.preprocess(emptyToUndef, z.string().max(5000).optional()),
  followUpAt: z.preprocess(emptyToUndef, z.string().datetime().optional()),
  status: z.enum(LEAD_STATUSES).optional(),
});

export const leadUpdateSchema = leadCreateSchema.partial().extend({
  archived: z.boolean().optional(),
});

export const leadListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  category: z.enum(['HOT', 'WARM', 'COLD']).optional(),
  campaignId: z.string().optional(),
  sort: z.enum(['createdAt', 'score', 'name', 'followUpAt']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  channel: z.enum(['email', 'social', 'search', 'referral', 'outbound', 'whatsapp', 'other']),
  status: z.enum(['active', 'paused', 'completed']).default('active'),
  budget: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().nonnegative().optional()),
  startDate: z.preprocess(emptyToUndef, z.string().datetime().optional()),
  endDate: z.preprocess(emptyToUndef, z.string().datetime().optional()),
});

export const automationRuleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  trigger: z.enum(['lead.created', 'lead.status_changed', 'lead.follow_up_due', 'schedule.daily']),
  conditions: z.record(z.any()).optional(),
  actions: z.array(z.object({ type: z.string(), params: z.record(z.any()).optional() })).min(1),
  enabled: z.boolean().default(true),
  maxRetries: z.number().int().min(0).max(10).default(3),
});

export const bookingSchema = z.object({
  leadId: z.preprocess(emptyToUndef, z.string().optional()),
  title: z.string().trim().min(1).max(200),
  scheduledAt: z.string().datetime(),
  durationMin: z.number().int().min(5).max(1440).default(30),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).default('scheduled'),
  revenue: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().nonnegative().optional()),
  notes: z.preprocess(emptyToUndef, z.string().max(2000).optional()),
});

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.preprocess(emptyToUndef, z.string().max(2000).optional()),
  dueAt: z.preprocess(emptyToUndef, z.string().datetime().optional()),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  relatedLeadId: z.preprocess(emptyToUndef, z.string().optional()),
});

export const teamInviteSchema = z.object({
  email: emailSchema,
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

export const trackEventSchema = z.object({
  organizationId: z.string().min(1),
  type: z.enum(['page_view', 'cta_click', 'form_submit', 'booking', 'purchase']),
  campaignId: z.preprocess(emptyToUndef, z.string().optional()),
  visitorId: z.preprocess(emptyToUndef, z.string().max(64).optional()),
  utmSource: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  utmMedium: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  utmCampaign: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  referrer: z.preprocess(emptyToUndef, z.string().max(500).optional()),
  path: z.preprocess(emptyToUndef, z.string().max(500).optional()),
  consentGiven: z.boolean().default(false),
  value: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), z.number().optional()),
});
