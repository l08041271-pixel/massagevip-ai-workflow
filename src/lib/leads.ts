import { prisma } from '@/lib/prisma';
import { scoreLead } from '@/lib/lead-scoring';
import { dispatch } from '@/lib/automation/engine';
import { audit } from '@/lib/audit';
import { AppError, Forbidden } from '@/lib/errors';
import { getPlan } from '@/lib/plans';
import type { z } from 'zod';
import type { leadCreateSchema } from '@/lib/validation';

type LeadCreateInput = z.infer<typeof leadCreateSchema>;

/** Find likely duplicates within the same organization only. */
export async function findDuplicates(organizationId: string, input: { email?: string | null; phone?: string | null; name?: string }) {
  const or = [];
  if (input.email) or.push({ email: input.email });
  if (input.phone) or.push({ phone: input.phone });
  if (or.length === 0) return [];
  return prisma.lead.findMany({
    where: { organizationId, archived: false, OR: or },
    select: { id: true, name: true, email: true, phone: true, status: true, createdAt: true },
    take: 5,
  });
}

export async function enforceLeadLimit(organizationId: string, plan: string) {
  const limit = getPlan(plan).limits.leads;
  if (limit === -1) return;
  const count = await prisma.lead.count({ where: { organizationId, archived: false } });
  if (count >= limit) {
    throw new Forbidden(`Your ${getPlan(plan).name} plan is limited to ${limit} leads. Upgrade to add more.`);
  }
}

export async function scoreAndPersist(organizationId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    include: { activities: true, bookings: true },
  });
  if (!lead) throw new AppError('Lead not found', 404, 'not_found');
  const result = scoreLead({
    email: lead.email, phone: lead.phone, company: lead.company, source: lead.source,
    intent: lead.intent, serviceInterest: lead.serviceInterest, budget: lead.budget,
    status: lead.status, activityCount: lead.activities.length,
    lastContactedAt: lead.lastContactedAt, createdAt: lead.createdAt, hasBooking: lead.bookings.length > 0,
  });
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      score: result.score,
      scoreCategory: result.category,
      scoreExplanation: result.explanation,
      recommendedAction: result.recommendedAction,
      scoreReasons: JSON.stringify(result.reasons),
    },
  });
  return result;
}

export async function createLead(params: {
  organizationId: string;
  actorId: string;
  plan: string;
  input: LeadCreateInput;
  skipAutomation?: boolean;
}) {
  const { organizationId, actorId, input } = params;
  await enforceLeadLimit(organizationId, params.plan);

  if (input.campaignId) {
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, organizationId } });
    if (!campaign) throw new AppError('Campaign not found in this workspace', 400, 'invalid_campaign');
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      source: input.source ?? 'manual',
      campaignId: input.campaignId ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      intent: input.intent ?? null,
      serviceInterest: input.serviceInterest ?? null,
      budget: input.budget ?? null,
      notes: input.notes ?? null,
      followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
      status: input.status ?? 'NEW',
    },
  });

  await prisma.leadActivity.create({
    data: { organizationId, leadId: lead.id, type: 'system', message: `Lead created (source: ${lead.source ?? 'manual'})`, actorId },
  });

  const score = await scoreAndPersist(organizationId, lead.id);
  await prisma.leadActivity.create({
    data: { organizationId, leadId: lead.id, type: 'score', message: `Scored ${score.score}/100 (${score.category})`, meta: JSON.stringify(score.reasons) },
  });

  await audit({ organizationId, actorId, action: 'lead.created', entity: 'lead', entityId: lead.id, meta: { source: lead.source } });

  if (!params.skipAutomation) {
    await dispatch({
      organizationId,
      trigger: 'lead.created',
      entityId: lead.id,
      leadId: lead.id,
      actorId,
      payload: { source: lead.source, status: lead.status, category: score.category },
    }).catch((e) => console.error('[automation] lead.created dispatch failed', e));
  }

  return { lead: await prisma.lead.findUnique({ where: { id: lead.id } }), score };
}
