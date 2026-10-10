import { requireOrg, type OrgContext, type Role, canWrite } from '@/lib/auth/context';
import { errorResponse, Forbidden } from '@/lib/errors';
import { rateLimit, clientKey } from '@/lib/rate-limit';

/**
 * Wrap an org-scoped API handler. Resolves + verifies tenant context, applies
 * optional rate limiting and role requirements, and normalizes errors.
 */
export function withOrg(
  handler: (req: Request, ctx: OrgContext, params?: Record<string, string>) => Promise<Response>,
  opts?: { write?: boolean; minRole?: Role; rate?: { limit: number; windowMs: number; scope: string } },
) {
  return async (req: Request, routeParams?: { params?: Record<string, string> }) => {
    try {
      if (opts?.rate) {
        const rl = rateLimit(clientKey(req, opts.rate.scope), opts.rate.limit, opts.rate.windowMs);
        if (!rl.allowed) return errorResponse(new (await import('@/lib/errors')).AppError('Too many requests. Please slow down.', 429, 'rate_limited'));
      }
      const ctx = await requireOrg(req.headers.get('x-org-id'));
      if (opts?.write && !canWrite(ctx)) throw Forbidden('Your role does not permit this action');
      return await handler(req, ctx, routeParams?.params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

export function searchParams(req: Request) {
  return new URL(req.url).searchParams;
}
