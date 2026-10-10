import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, hasWhatsAppCredentials } from '@/lib/env';

export interface SendResult {
  ok: boolean;
  providerId?: string;
  delivered: boolean;
  mock: boolean;
  error?: string;
}

/**
 * WhatsApp Business Cloud API adapter.
 * - Verifies webhook signatures (X-Hub-Signature-256) when an app secret is set.
 * - Uses a mock adapter locally when credentials are absent.
 * - Only reports delivered=true when the provider accepts the message; final
 *   delivery is confirmed asynchronously via status webhooks.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!env.whatsapp.appSecret) return false;
  if (!signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', env.whatsapp.appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyWebhookToken(mode: string | null, token: string | null): boolean {
  return mode === 'subscribe' && !!env.whatsapp.verifyToken && token === env.whatsapp.verifyToken;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<SendResult> {
  if (!hasWhatsAppCredentials()) {
    // Mock adapter: records the attempt without claiming delivery.
    return { ok: true, delivered: false, mock: true, providerId: `mock_${Date.now()}`, error: 'WhatsApp not configured — message recorded in mock mode (not delivered).' };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${env.whatsapp.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.whatsapp.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
    });
    const json = (await res.json()) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { ok: false, delivered: false, mock: false, error: json.error?.message ?? `WhatsApp error (${res.status})` };
    return { ok: true, providerId: json.messages?.[0]?.id, delivered: false, mock: false };
  } catch (e) {
    return { ok: false, delivered: false, mock: false, error: e instanceof Error ? e.message : 'WhatsApp request failed' };
  }
}

export function whatsappStatus() {
  return { configured: hasWhatsAppCredentials(), verifyTokenSet: Boolean(env.whatsapp.verifyToken), appSecretSet: Boolean(env.whatsapp.appSecret) };
}
