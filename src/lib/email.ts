import { env } from '@/lib/env';

/**
 * Transactional email interface. The default 'log' provider writes to the
 * server log so local/dev flows are observable without a provider. Swap in a
 * real provider (Resend/Postmark/SES) by implementing sendViaProvider.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; provider: string; error?: string }> {
  if (env.email.provider === 'log') {
    console.info(`[email:log] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return { ok: true, provider: 'log' };
  }
  // Real providers are wired here in production.
  return { ok: false, provider: env.email.provider, error: `Email provider "${env.email.provider}" is not implemented. Configure EMAIL_PROVIDER=log or add a provider adapter.` };
}
