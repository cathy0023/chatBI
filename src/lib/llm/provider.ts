import { createOpenAI } from '@ai-sdk/openai';

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
