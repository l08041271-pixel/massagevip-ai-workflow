import { withOrg, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';
import { dashboardMetrics, resolvePeriod } from '@/lib/reporting';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  const period = resolvePeriod(sp.get('range'), sp.get('from'), sp.get('to'));
  return ok(await dashboardMetrics(ctx.organizationId, period));
});
