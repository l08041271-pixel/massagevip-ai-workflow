import { prisma } from '@/lib/prisma';
import { withOrg, parseJson } from '@/lib/api';
import { ok } from '@/lib/errors';
import { z } from 'zod';

const schema = z.object({
  step: z.number().int().min(0).max(10),
  complete: z.boolean().optional(),
  industry: z.string().max(120).optional(),
});

export const POST = withOrg(async (req, ctx) => {
  const body = schema.parse(await parseJson(req));
  const org = await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: {
      onboardingStep: body.step,
      onboardingDone: body.complete ?? undefined,
      industry: body.industry ?? undefined,
    },
  });
  return ok({ onboardingStep: org.onboardingStep, onboardingDone: org.onboardingDone });
}, { write: true });
