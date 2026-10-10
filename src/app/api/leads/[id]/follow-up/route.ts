import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok, NotFound } from '@/lib/errors';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { z } from 'zod';

const schema = z.object({ message: z.string().min(1).max(2000), channel: z.enum(['whatsapp', 'email', 'manual']).default('whatsapp') });

/**
 * Authorized follow-up. For WhatsApp we only report 'accepted' when the provider
 * accepts the message; otherwise the attempt is logged honestly.
 */
export const POST = withOrg(async (req, ctx, params) => {
  const lead = await prisma.lead.findFirst({ where: { id: params!.id, organizationId: ctx.organizationId } });
  if (!lead) throw NotFound('Lead not found');
  const body = schema.parse(await parseJson(req));

  let detail = 'Logged as manual follow-up.';
  if (body.channel === 'whatsapp') {
    if (!lead.phone) detail = 'No phone number on file — follow-up not sent.';
    else {
      const res = await sendWhatsAppMessage(lead.phone, body.message);
      detail = res.ok
        ? res.mock
          ? 'WhatsApp not configured: message recorded in mock mode (not delivered).'
          : 'WhatsApp message accepted by provider (delivery pending).'
        : `WhatsApp send failed: ${res.error}`;
    }
  }

  const activity = await prisma.leadActivity.create({
    data: { organizationId: ctx.organizationId, leadId: lead.id, type: 'message', message: `${body.channel} follow-up: ${body.message}\n${detail}`, actorId: ctx.userId },
  });
  await prisma.lead.updateMany({ where: { id: lead.id, organizationId: ctx.organizationId }, data: { lastContactedAt: new Date() } });
  return ok({ activity, detail });
}, { write: true, rate: { limit: 30, windowMs: 60_000, scope: 'followup' } });
