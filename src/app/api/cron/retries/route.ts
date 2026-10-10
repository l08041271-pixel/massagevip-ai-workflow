import { processRetries } from '@/lib/automation/engine';
import { errorResponse, ok, AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { dispatch } from '@/lib/automation/engine';

/**
 * Cron endpoint: processes due automation retries and runs daily-schedule rules.
 * Protect with CRON_SECRET (Authorization: Bearer <secret>) in production.
 */
export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.headers.get('authorization');
      if (auth !== `Bearer ${secret}`) throw new AppError('Unauthorized cron invocation', 401, 'unauthorized');
    }
    const retried = await processRetries();

    const orgs = await prisma.organization.findMany({ select: { id: true } });
    let scheduled = 0;
    for (const org of orgs) {
      const runs = await dispatch({ organizationId: org.id, trigger: 'schedule.daily', payload: { date: new Date().toISOString().slice(0, 10) } });
      scheduled += runs.filter((r) => !r.deduped).length;
    }
    return ok({ retried: retried.length, scheduled });
  } catch (e) {
    return errorResponse(e);
  }
}
