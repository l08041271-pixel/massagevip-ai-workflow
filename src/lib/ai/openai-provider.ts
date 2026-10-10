import type { AiCompletion, AiMessage, AiProvider } from './provider';

/** OpenAI-compatible chat completions provider (works with OpenAI, Azure-compatible gateways, etc.). */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly demo = false;

  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
  ) {}

  async complete(messages: AiMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<AiCompletion> {
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: opts?.maxTokens ?? 800,
          temperature: opts?.temperature ?? 0.4,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        // Never echo secrets; only the provider's own error text.
        return { ok: false, text: '', provider: this.name, model: this.model, demo: false, error: `AI provider error (${res.status}): ${body.slice(0, 300)}` };
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = json.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        return { ok: false, text: '', provider: this.name, model: this.model, demo: false, error: 'AI provider returned an empty response' };
      }
      return { ok: true, text, provider: this.name, model: this.model, demo: false };
    } catch (e) {
      return { ok: false, text: '', provider: this.name, model: this.model, demo: false, error: e instanceof Error ? e.message : 'AI request failed' };
    }
  }
}
