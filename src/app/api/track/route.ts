import { prisma } from '@/lib/prisma';
import { trackEventSchema } from '@/lib/validation';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { rateLimit, clientKey } from '@/lib/rate-limit';

/**
 * Public, cookie-less marketing event ingestion endpoint.
 * Data minimization: we store an anonymous visitor id (if provided), UTM
 * parameters, referrer host and path — never IP addresses or personal data.
 * Events without consent are stored as page views only (no value).
 */
export async function POST(req: Request) {
  try {
    const rl = rateLimit(clientKey(req, 'track'), 120, 60_000);
    if (!rl.allowed) throw new AppError('Too many events', 429, 'rate_limited');
    const body = trackEventSchema.parse(await req.json());
    const org = await prisma.organization.findUnique({ where: { id: body.organizationId }, select: { id: true } });
    if (!org) throw new AppError('Unknown workspace', 404, 'not_found');

    if (body.campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: body.campaignId, organizationId: org.id } });
      if (!campaign) throw new AppError('Unknown campaign', 400, 'invalid_campaign');
    }

    await prisma.marketingEvent.create({
      data: {
        organizationId: org.id,
        campaignId: body.campaignId ?? null,
        type: body.type,
        visitorId: body.visitorId ?? null,
        utmSource: body.utmSource ?? null,
        utmMedium: body.utmMedium ?? null,
        utmCampaign: body.utmCampaign ?? null,
        referrer: body.referrer ? safeHost(body.referrer) : null,
        path: body.path ?? null,
        consentGiven: body.consentGiven,
        value: body.consentGiven ? body.value ?? null : null,
      },
    });
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 100);
  }
}
