import { env, hasAiCredentials } from '@/lib/env';
import { DemoAiProvider } from './demo-provider';
import { OpenAiProvider } from './openai-provider';
import type { AiProvider } from './provider';

export function getAiProvider(): AiProvider {
  if (hasAiCredentials()) {
    return new OpenAiProvider(env.ai.apiKey!, env.ai.model, env.ai.baseUrl);
  }
  return new DemoAiProvider();
}

export const AI_FEATURE_REQUIREMENTS =
  'Natural-language generation requires AI_PROVIDER=openai and AI_API_KEY. Without them, GrowthPilot uses the built-in demo assistant.';

export * from './provider';
