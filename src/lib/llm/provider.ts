import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Support custom base URL for proxy providers
const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const apiKey = process.env.OPENAI_API_KEY || '';

if (!apiKey) {
  console.warn('[ChatBI] OPENAI_API_KEY is not set. LLM features will not work.');
}

export const openai = createOpenAI({
  baseURL,
  apiKey,
});

// Default model (can be overridden via env)
export const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// Convenience function
export function getDefaultModel() {
  return openai(DEFAULT_MODEL);
}

// streamText-based generateText replacement
// The proxy API returns invalid JSON for non-streaming requests,
// so we use streamText and collect the full result.
export async function generateTextCompat(options: {
  prompt?: string;
  system?: string;
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  maxTokens?: number;
}): Promise<{ text: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { maxTokens, ...rest } = options;
  const result = streamText({
    model: getDefaultModel(),
    maxTokens: maxTokens || 4096,
    ...(rest as any),
  });

  let text = '';
  for await (const chunk of result.textStream) {
    text += chunk;
  }
  return { text };
}
