/** Provider abstraction for AI integrations. */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletion {
  ok: boolean;
  text: string;
  provider: string;
  model?: string;
  demo: boolean;
  error?: string;
}

export interface AiProvider {
  readonly name: string;
  readonly demo: boolean;
  complete(messages: AiMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<AiCompletion>;
}
