import { withOrg, searchParams } from '@/lib/api';
import { ok } from '@/lib/errors';
import { findDuplicates } from '@/lib/leads';

export const GET = withOrg(async (req, ctx) => {
  const sp = searchParams(req);
  const duplicates = await findDuplicates(ctx.organizationId, { email: sp.get('email'), phone: sp.get('phone'), name: sp.get('name') ?? undefined });
  return ok({ duplicates });
});
