import { destroySession } from '@/lib/auth/session';
import { errorResponse, ok } from '@/lib/errors';

export async function POST() {
  try {
    await destroySession();
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
