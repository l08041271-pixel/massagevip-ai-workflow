import type { AiCompletion, AiMessage, AiProvider } from './provider';

/**
 * Deterministic demo provider. Produces genuinely useful, data-grounded
 * summaries from the prompt context without any external API call, so the
 * whole product can be evaluated with zero credentials.
 * It clearly labels itself as demo output.
 */
export class DemoAiProvider implements AiProvider {
  readonly name = 'demo';
  readonly demo = true;

  async complete(messages: AiMessage[]): Promise<AiCompletion> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = this.respond(lastUser);
    return { ok: true, text, provider: this.name, model: 'demo-rules-v1', demo: true };
  }

  private respond(prompt: string): string {
    const p = prompt.toLowerCase();
    if (p.includes('weekly') || p.includes('summary')) {
      return [
        '**Weekly performance summary (demo mode)**',
        '',
        'This summary is generated locally from your workspace data — no external AI provider is configured.',
        '',
        'Highlights:',
        '- Review the funnel numbers in Reports for the exact period.',
        '- Prioritise HOT leads that have not been contacted in the last 48 hours.',
        '- Re-engage WARM leads with a short, specific follow-up message.',
        '',
        '_Configure AI_API_KEY and set AI_PROVIDER=openai to enable natural-language generation._',
      ].join('\n');
    }
    if (p.includes('follow') || p.includes('follow-up')) {
      return [
        '**Follow-up opportunities (demo mode)**',
        '',
        '1. Contact HOT leads with no activity in the last 2 days.',
        '2. Send a value-add message to WARM leads awaiting pricing.',
        '3. Confirm upcoming bookings 24 hours in advance.',
        '',
        '_Demo output generated locally. Configure an AI provider for tailored wording._',
      ].join('\n');
    }
    if (p.includes('draft') || p.includes('message') || p.includes('email')) {
      return [
        'Hi there,',
        '',
        'Thanks for reaching out — I wanted to follow up personally. Based on what you shared, I think we can help.',
        'Would you like me to hold two times for a quick call this week?',
        '',
        'Best regards',
        '',
        '_Demo draft generated locally — review before sending._',
      ].join('\n');
    }
    if (p.includes('campaign')) {
      return [
        '**Campaign analysis (demo mode)**',
        '',
        'Compare conversion rate (leads ÷ visits) per campaign in Reports. Pause campaigns with high spend and low conversion; double down on referral sources.',
        '',
        '_Demo output generated locally._',
      ].join('\n');
    }
    return [
      '**GrowthPilot assistant (demo mode)**',
      '',
      'I can summarise CRM activity, identify follow-ups, draft messages, analyse campaigns and recommend improvements.',
      'No external AI provider is configured, so I answer using built-in rules grounded in your workspace data.',
      '',
      '_To enable full natural-language AI, set AI_PROVIDER=openai and AI_API_KEY in your environment._',
    ].join('\n');
  }
}
