import { prisma } from '@/lib/prisma';
import { withOrg, parseJson, searchParams } from '@/lib/api';
import { ok, NotFound } from '@/lib/errors';
import { bookingSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  const bookings = await prisma.booking.findMany({
    where: { organizationId: ctx.organizationId, ...(sp.get('status') ? { status: sp.get('status')! } : {}) },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
    include: { lead: { select: { name: true } } },
  });
  return ok({ bookings });
});

export const POST = withOrg(async (req, ctx) => {
  const body = bookingSchema.parse(await parseJson(req));
  if (body.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: body.leadId, organizationId: ctx.organizationId } });
    if (!lead) throw NotFound('Lead not found in this workspace');
  }
  const booking = await prisma.booking.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: body.leadId ?? null,
      title: body.title,
      scheduledAt: new Date(body.scheduledAt),
      durationMin: body.durationMin,
      status: body.status,
      revenue: body.revenue ?? null,
      notes: body.notes ?? null,
    },
  });
  if (body.leadId) {
    await prisma.leadActivity.create({ data: { organizationId: ctx.organizationId, leadId: body.leadId, type: 'booking', message: `Booking created: ${body.title}`, actorId: ctx.userId } });
    await prisma.lead.updateMany({ where: { id: body.leadId, organizationId: ctx.organizationId }, data: { status: 'BOOKED' } });
  }
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: 'booking.created', entity: 'booking', entityId: booking.id });
  return ok({ booking }, { status: 201 });
}, { write: true });
