import { withOrg, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';
import { retentionReport, resolvePeriod } from '@/lib/reporting';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  return ok(await retentionReport(ctx.organizationId, resolvePeriod(sp.get('range'), sp.get('from'), sp.get('to'))));
});
