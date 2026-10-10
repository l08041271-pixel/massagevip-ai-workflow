/**
 * Development seed. Creates a clearly-labelled DEMO workspace (isDemo=true) so
 * it is always distinguishable from real customer data. Never run in production.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { scoreLead } from '../src/lib/lead-scoring';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL ?? 'demo@growthpilot.ai';
  const password = process.env.SEED_PASSWORD ?? 'Demo1234';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Demo user already exists: ${email}. Skipping seed.`);
    return;
  }

  const user = await prisma.user.create({
    data: { email, name: 'Demo Owner', passwordHash: await bcrypt.hash(password, 12) },
  });

  const org = await prisma.organization.create({
    data: {
      name: 'Demo Wellness Studio',
      slug: `demo-wellness-${Date.now().toString(36)}`,
      industry: 'Health & Wellness',
      isDemo: true,
      onboardingDone: true,
      onboardingStep: 5,
      subscription: { create: { plan: 'pro', status: 'active' } },
      memberships: { create: { userId: user.id, role: 'OWNER' } },
    },
  });

  const campaigns = await Promise.all([
    prisma.campaign.create({ data: { organizationId: org.id, name: 'Spring Wellness Promo', channel: 'social', status: 'active', budget: 500 } }),
    prisma.campaign.create({ data: { organizationId: org.id, name: 'Google Search — Massage', channel: 'search', status: 'active', budget: 1200 } }),
    prisma.campaign.create({ data: { organizationId: org.id, name: 'Referral Program', channel: 'referral', status: 'active', budget: 200 } }),
  ]);

  const leadSeeds = [
    { name: 'Ava Thompson', email: 'ava@example.com', phone: '+15550001', source: 'campaign', campaignId: campaigns[1].id, intent: 'ready to buy a package', serviceInterest: 'Deep tissue massage', budget: 600, status: 'QUALIFIED' },
    { name: 'Ben Carter', email: 'ben@example.com', phone: '+15550002', source: 'referral', intent: 'asked for pricing', serviceInterest: 'Sports massage', status: 'CONTACTED' },
    { name: 'Chloe Nguyen', email: 'chloe@example.com', phone: '+15550003', source: 'website', intent: 'book a consultation', serviceInterest: 'Relaxation massage', budget: 200, status: 'BOOKED' },
    { name: 'Dan Patel', phone: '+15550004', source: 'whatsapp', intent: 'information', status: 'NEW' },
    { name: 'Emma Ruiz', email: 'emma@example.com', source: 'campaign', campaignId: campaigns[0].id, intent: 'demo', status: 'NEW' },
    { name: 'Frank Lee', email: 'frank@example.com', phone: '+15550006', company: 'Lee Consulting', source: 'manual', intent: 'request a quote', serviceInterest: 'Corporate wellness', budget: 5000, status: 'CONTACTED' },
    { name: 'Grace Kim', email: 'grace@example.com', source: 'social', status: 'LOST' },
  ];

  for (const seed of leadSeeds) {
    const lead = await prisma.lead.create({ data: { organizationId: org.id, ...seed } });
    await prisma.leadActivity.create({ data: { organizationId: org.id, leadId: lead.id, type: 'system', message: 'Lead created via seed data' } });
    const result = scoreLead({ ...seed, createdAt: lead.createdAt, activityCount: 1 });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score: result.score, scoreCategory: result.category, scoreExplanation: result.explanation, recommendedAction: result.recommendedAction, scoreReasons: JSON.stringify(result.reasons) },
    });
  }

  const chloe = await prisma.lead.findFirst({ where: { organizationId: org.id, name: 'Chloe Nguyen' } });
  if (chloe) {
    await prisma.booking.create({ data: { organizationId: org.id, leadId: chloe.id, title: 'Relaxation massage', scheduledAt: new Date(Date.now() + 2 * 86400000), status: 'scheduled', revenue: 120 } });
  }

  for (let i = 0; i < 40; i++) {
    await prisma.marketingEvent.create({
      data: {
        organizationId: org.id,
        campaignId: campaigns[i % campaigns.length].id,
        type: i % 5 === 0 ? 'form_submit' : i % 3 === 0 ? 'cta_click' : 'page_view',
        visitorId: `visitor_${i}`,
        utmSource: 'seed',
        consentGiven: true,
        occurredAt: new Date(Date.now() - i * 3600_000),
      },
    });
  }

  await prisma.automationRule.create({
    data: {
      organizationId: org.id,
      name: 'New lead: score + follow-up task',
      trigger: 'lead.created',
      actions: JSON.stringify([
        { type: 'score_lead' },
        { type: 'schedule_follow_up', params: { days: 2 } },
        { type: 'create_task', params: { title: 'Follow up with new lead', priority: 'high' } },
        { type: 'notify_owner', params: { message: 'A new lead was captured and scored.' } },
      ]),
      enabled: true,
      maxRetries: 3,
    },
  });

  await prisma.task.create({ data: { organizationId: org.id, title: 'Call Ava about package pricing', priority: 'high', dueAt: new Date(Date.now() + 86400000) } });

  console.log('Seed complete.');
  console.log(`  Login: ${email}`);
  console.log(`  Password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
