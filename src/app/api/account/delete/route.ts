import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok, AppError } from '@/lib/errors';
import { z } from 'zod';

/** Irreversible workspace deletion. Requires OWNER role + explicit confirmation. */
export const POST = withOrg(async (req, ctx) => {
  const body = z.object({ confirm: z.literal('DELETE') }).parse(await parseJson(req));
  if (body.confirm !== 'DELETE') throw new AppError('Confirmation required', 400, 'confirmation_required');
  await prisma.organization.delete({ where: { id: ctx.organizationId } });
  return ok({ ok: true });
}, { write: true, minRole: 'OWNER' });
