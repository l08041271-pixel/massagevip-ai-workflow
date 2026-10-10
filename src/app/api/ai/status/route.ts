import { withOrg } from '@/lib/api';
import { ok } from '@/lib/errors';
import { getAiProvider, AI_FEATURE_REQUIREMENTS } from '@/lib/ai';

export const GET = withOrg(async () => {
  const provider = getAiProvider();
  return ok({ provider: provider.name, demo: provider.demo, requirements: AI_FEATURE_REQUIREMENTS });
});
