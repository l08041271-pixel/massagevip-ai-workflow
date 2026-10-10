import { prisma } from '@/lib/prisma';

export interface Period {
  from: Date;
  to: Date;
}

export function resolvePeriod(range?: string | null, from?: string | null, to?: string | null): Period {
  const now = new Date();
  if (from && to) return { from: new Date(from), to: new Date(to) };
  const end = now;
  const start = new Date(now);
  switch (range) {
    case 'today': start.setHours(0, 0, 0, 0); break;
    case '7d': start.setDate(now.getDate() - 7); break;
    case '30d': start.setDate(now.getDate() - 30); break;
    case '90d': start.setDate(now.getDate() - 90); break;
    case '12m': start.setFullYear(now.getFullYear() - 1); break;
    default: start.setDate(now.getDate() - 30);
  }
  return { from: start, to: end };
}

export async function dashboardMetrics(organizationId: string, period: Period) {
  const { from, to } = period;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [totalLeads, newLeadsToday, qualified, booked, periodLeads, bookings, revenueAgg, byStatus, recentActivity, tasks] = await Promise.all([
    prisma.lead.count({ where: { organizationId, archived: false } }),
    prisma.lead.count({ where: { organizationId, createdAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { organizationId, status: { in: ['QUALIFIED', 'BOOKED', 'COMPLETED'] } } }),
    prisma.booking.count({ where: { organizationId, status: { in: ['scheduled', 'completed'] }, scheduledAt: { gte: from, lte: to } } }),
    prisma.lead.count({ where: { organizationId, createdAt: { gte: from, lte: to } } }),
    prisma.booking.findMany({ where: { organizationId, scheduledAt: { gte: from, lte: to } }, select: { status: true, revenue: true } }),
    prisma.booking.aggregate({ where: { organizationId, scheduledAt: { gte: from, lte: to } }, _sum: { revenue: true } }),
    prisma.lead.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.leadActivity.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 8, include: { lead: { select: { name: true } } } }),
    prisma.task.findMany({ where: { organizationId, completed: false }, orderBy: [{ priority: 'desc' }, { dueAt: 'asc' }], take: 6 }),
  ]);

  const conversions = byStatus.find((s) => s.status === 'COMPLETED')?._count._all ?? 0;
  const conversionRate = periodLeads > 0 ? (conversions / periodLeads) * 100 : 0;
  const completedBookings = bookings.filter((b) => b.status === 'completed').length;

  return {
    period,
    totals: {
      totalLeads,
      newLeadsToday,
      qualified,
      bookings,
      conversionRate: round(conversionRate),
      revenue: revenueAgg._sum.revenue ?? 0,
      completedBookings,
    },
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    recentActivity,
    tasks,
  };
}

export async function campaignReport(organizationId: string, period: Period) {
  const campaigns = await prisma.campaign.findMany({ where: { organizationId } });
  const events = await prisma.marketingEvent.groupBy({
    by: ['campaignId', 'type'],
    where: { organizationId, occurredAt: { gte: period.from, lte: period.to } },
    _count: { _all: true },
    _sum: { value: true },
  });
  const leads = await prisma.lead.groupBy({
    by: ['campaignId'],
    where: { organizationId, createdAt: { gte: period.from, lte: period.to } },
    _count: { _all: true },
  });
  const booked = await prisma.lead.groupBy({
    by: ['campaignId'],
    where: { organizationId, createdAt: { gte: period.from, lte: period.to }, status: { in: ['BOOKED', 'COMPLETED'] } },
    _count: { _all: true },
  });

  const rows = campaigns.map((c) => {
    const ev = events.filter((e) => e.campaignId === c.id);
    const visits = ev.filter((e) => e.type === 'page_view').reduce((s, e) => s + e._count._all, 0);
    const clicks = ev.filter((e) => e.type === 'cta_click').reduce((s, e) => s + e._count._all, 0);
    const submissions = ev.filter((e) => e.type === 'form_submit').reduce((s, e) => s + e._count._all, 0);
    const revenue = ev.reduce((s, e) => s + (e._sum.value ?? 0), 0);
    const leadCount = leads.find((l) => l.campaignId === c.id)?._count._all ?? 0;
    const bookedCount = booked.find((b) => b.campaignId === c.id)?._count._all ?? 0;
    return {
      campaignId: c.id,
      name: c.name,
      channel: c.channel,
      status: c.status,
      budget: c.budget ?? 0,
      visits,
      clicks,
      submissions,
      leads: leadCount,
      booked: bookedCount,
      revenue,
      clickThroughRate: visits > 0 ? round((clicks / visits) * 100) : 0,
      conversionRate: visits > 0 ? round((leadCount / visits) * 100) : 0,
      costPerLead: leadCount > 0 ? round((c.budget ?? 0) / leadCount) : 0,
      returnOnSpend: (c.budget ?? 0) > 0 ? round(revenue / (c.budget ?? 1)) : 0,
    };
  });
  return { period, rows };
}

export async function funnelReport(organizationId: string, period: Period) {
  const counts = await prisma.lead.groupBy({
    by: ['status'],
    where: { organizationId, createdAt: { gte: period.from, lte: period.to } },
    _count: { _all: true },
  });
  const order = ['NEW', 'CONTACTED', 'QUALIFIED', 'BOOKED', 'COMPLETED', 'LOST'];
  const byStatus = order.map((s) => ({ status: s, count: counts.find((c) => c.status === s)?._count._all ?? 0 }));
  const total = byStatus.reduce((s, r) => s + r.count, 0);
  return {
    period,
    total,
    stages: byStatus.map((r, i) => ({
      ...r,
      shareOfTotal: total > 0 ? round((r.count / total) * 100) : 0,
      stageConversion: i > 0 && byStatus[i - 1].count > 0 ? round((r.count / byStatus[i - 1].count) * 100) : 0,
    })),
  };
}

export async function automationReport(organizationId: string, period: Period) {
  const runs = await prisma.automationExecution.groupBy({
    by: ['status'],
    where: { organizationId, createdAt: { gte: period.from, lte: period.to } },
    _count: { _all: true },
  });
  const total = runs.reduce((s, r) => s + r._count._all, 0);
  const succeeded = runs.find((r) => r.status === 'succeeded')?._count._all ?? 0;
  const failed = runs.find((r) => r.status === 'failed')?._count._all ?? 0;
  return {
    period,
    total,
    succeeded,
    failed,
    successRate: total > 0 ? round((succeeded / total) * 100) : 0,
    byStatus: runs.map((r) => ({ status: r.status, count: r._count._all })),
  };
}

export async function retentionReport(organizationId: string, period: Period) {
  // Only meaningful with sufficient data; returns a flag when data is sparse.
  const bookings = await prisma.booking.findMany({
    where: { organizationId, status: 'completed', scheduledAt: { gte: period.from, lte: period.to } },
    select: { leadId: true },
  });
  const withLead = bookings.filter((b) => b.leadId);
  const counts = new Map<string, number>();
  for (const b of withLead) counts.set(b.leadId!, (counts.get(b.leadId!) ?? 0) + 1);
  const repeat = [...counts.values()].filter((c) => c > 1).length;
  const unique = counts.size;
  return {
    period,
    sufficientData: unique >= 10,
    uniqueCustomers: unique,
    repeatCustomers: repeat,
    repeatRate: unique > 0 ? round((repeat / unique) * 100) : 0,
  };
}

function round(n: number, dp = 2) {
  return Math.round(n * 10 ** dp) / 10 ** dp;
}
